import * as THREE from 'three';
import { BOAT, GRAVITY, TEAM_COLORS, type Team } from '../config';
import { Physics, RAPIER } from '../physics/Physics';
import { waterHeightAt } from '../water/WaveModel';
import { buildBoatMesh, type BoatVisual } from './BoatMesh';
import { Trail, makeTrailMaterial } from '../fx/Trail';
import { makeWakeTexture } from '../render/ProceduralTextures';
import type { FxContext } from '../fx/FxContext';

export interface BoatControls {
  throttle: number;
  steer: number;
  pitch: number;
  roll: number;
  boost: boolean;
  /** True only on the frame the jump button was pressed. */
  jump: boolean;
}

export function emptyControls(): BoatControls {
  return { throttle: 0, steer: 0, pitch: 0, roll: 0, boost: false, jump: false };
}

const SAMPLE_POINTS: [number, number][] = [];
for (const x of [-0.78, 0, 0.78]) for (const z of [-1.35, -0.45, 0.45, 1.3]) SAMPLE_POINTS.push([x, z]);
const SAMPLE_Y = -0.42;
const N_SAMPLES = SAMPLE_POINTS.length;

let wakeTexture: THREE.Texture | null = null;

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class Boat {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly visual: BoatVisual;
  readonly wake: Trail;
  readonly controls: BoatControls = emptyControls();
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, 1);
  readonly right = new THREE.Vector3(1, 0, 0);
  readonly up = new THREE.Vector3(0, 1, 0);

  boost = BOAT.startBoost;
  submerged = 0;
  inWater = true;
  boosting = false;
  supersonic = false;
  speed = 0;
  airTime = 0;
  demolished = 0;
  stats = { touches: 0, goals: 0, saves: 0, boostUsed: 0 };

  private hasDoubleJump = false;
  private sinceJump = 99;
  private jumpCooldown = 0;
  private flipTimer = 0;
  private flipAxis = new THREE.Vector3();
  private prevInWater = true;
  private squish = 0;
  private squishVel = 0;
  private blinkTimer = 2 + Math.random() * 3;
  private blink = 0;
  private motorYaw = 0;
  private flameFlicker = 0;
  private prevPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private lookTarget = new THREE.Vector3();

  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();

  constructor(
    readonly id: number,
    readonly team: Team,
    readonly name: string,
    readonly isPlayer: boolean,
    physics: Physics,
    scene: THREE.Scene,
    variant: number,
  ) {
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0).setLinearDamping(0).setAngularDamping(1.5).setCcdEnabled(true);
    this.body = physics.world.createRigidBody(desc);
    const colDesc = RAPIER.ColliderDesc.roundCuboid(BOAT.width / 2 - 0.25, BOAT.height / 2 - 0.2, BOAT.length / 2 - 0.3, 0.25)
      .setMass(BOAT.mass)
      .setRestitution(0.35)
      .setFriction(0.5)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.collider = physics.world.createCollider(colDesc, this.body);
    physics.register(this.collider, { kind: 'boat', id });

    this.visual = buildBoatMesh(team, variant);
    scene.add(this.visual.root);

    wakeTexture ??= makeWakeTexture();
    this.wake = new Trail({
      maxPoints: 60,
      life: 2.2,
      startWidth: 1.3,
      endWidth: 2.8,
      onSurface: true,
      minSpacing: 0.35,
      material: makeTrailMaterial(wakeTexture, new THREE.Color(1, 1, 1), false, 0.55),
    });
    scene.add(this.wake.mesh);
  }

  get teamColor(): THREE.Color {
    return new THREE.Color(TEAM_COLORS[this.team].main);
  }

  reset(x: number, z: number, yaw: number) {
    this.body.setTranslation({ x, y: 0.1, z }, true);
    const q = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, yaw);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.boost = BOAT.startBoost;
    this.hasDoubleJump = false;
    this.flipTimer = 0;
    this.sinceJump = 99;
    this.demolished = 0;
    this.wake.clear();
    this.syncFromBody();
    this.prevPos.copy(this.position);
    this.prevQuat.copy(this.quaternion);
  }

  private syncFromBody() {
    const p = this.body.translation();
    const r = this.body.rotation();
    this.position.set(p.x, p.y, p.z);
    this.quaternion.set(r.x, r.y, r.z, r.w);
    const v = this.body.linvel();
    this.velocity.set(v.x, v.y, v.z);
    this.forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.speed = this.velocity.length();
  }

  /** Physics step. `time` is the simulation time used by the wave model. */
  fixedUpdate(dt: number, time: number, fx: FxContext) {
    this.prevPos.copy(this.position);
    this.prevQuat.copy(this.quaternion);
    const b = this.body;
    b.resetForces(false);
    b.resetTorques(false);
    this.syncFromBody();

    const m = BOAT.mass;
    const c = this.controls;
    const av = b.angvel();
    const angvel = this.tmpV3.set(av.x, av.y, av.z);

    // ---------------- buoyancy ----------------
    let submergedSum = 0;
    let deepest = 0;
    for (let i = 0; i < N_SAMPLES; i++) {
      const [lx, lz] = SAMPLE_POINTS[i];
      const p = this.tmpV.set(lx, SAMPLE_Y, lz).applyQuaternion(this.quaternion).add(this.position);
      const h = waterHeightAt(p.x, p.z, time);
      const d = h - p.y;
      if (d <= 0) continue;
      deepest = Math.max(deepest, d);
      const ratio = Math.min(d / BOAT.restDraft, 3.0);
      const lift = ((m * GRAVITY) / N_SAMPLES) * ratio;
      // vertical velocity of this hull point: v + w x r
      const r = this.tmpV2.subVectors(p, this.position);
      const vpy = this.velocity.y + (angvel.z * r.x - angvel.x * r.z);
      const damp = -(m / N_SAMPLES) * 4.5 * vpy;
      b.addForceAtPoint({ x: 0, y: lift + damp, z: 0 }, { x: p.x, y: p.y, z: p.z }, true);
      submergedSum += Math.min(1, d / (2 * BOAT.restDraft));
    }
    this.submerged = submergedSum / N_SAMPLES;
    this.prevInWater = this.inWater;
    this.inWater = this.submerged > 0.12;
    const s = Math.min(1, this.submerged * 2);

    if (this.inWater) {
      this.airTime = 0;
      this.hasDoubleJump = false;
      this.flipTimer = 0;
      // hydrodynamic drag
      const hv = this.tmpV.set(this.velocity.x, 0, this.velocity.z);
      const hs = hv.length();
      const dragK = (BOAT.waterLinearDrag + BOAT.waterQuadDrag * hs) * s * m;
      b.addForce({ x: -hv.x * dragK, y: 0, z: -hv.z * dragK }, true);
      // keel grip: resist sideways slip
      const lat = this.right.dot(this.velocity);
      const keel = -lat * m * BOAT.keelGrip * s;
      b.addForce({ x: this.right.x * keel, y: 0, z: this.right.z * keel }, true);
      // righting torque + roll/pitch damping (low centre of gravity)
      const cross = this.tmpV2.crossVectors(this.up, WORLD_UP);
      const k = m * BOAT.rightingTorque * 0.3 * s;
      const yawRate = angvel.dot(this.up);
      const horizAng = this.tmpV.copy(angvel).addScaledVector(this.up, -yawRate);
      b.addTorque(
        { x: cross.x * k - horizAng.x * m * 1.1, y: cross.y * k - horizAng.y * m * 1.1, z: cross.z * k - horizAng.z * m * 1.1 },
        true,
      );
      b.setAngularDamping(2.4);
      b.setLinearDamping(0);

      // ---------------- propulsion ----------------
      const propLocal = this.tmpV.set(0, -0.15, -1.6).applyQuaternion(this.quaternion).add(this.position);
      const propDepth = waterHeightAt(propLocal.x, propLocal.z, time) - (propLocal.y - 0.35);
      if (propDepth > 0 && this.demolished <= 0) {
        const fwdH = this.tmpV2.set(this.forward.x, 0, this.forward.z).normalize();
        const t = c.throttle > 0 ? c.throttle : c.throttle * BOAT.reverseFactor;
        const thrust = m * BOAT.thrust * t * Math.min(1, propDepth / 0.3);
        b.addForceAtPoint({ x: fwdH.x * thrust, y: 0, z: fwdH.z * thrust }, { x: propLocal.x, y: propLocal.y, z: propLocal.z }, true);

        const fwdSpeed = this.forward.dot(this.velocity);
        const speedFactor = THREE.MathUtils.clamp(Math.abs(fwdSpeed) / 6, 0.35, 1);
        const dir = fwdSpeed >= -0.8 ? 1 : -1;
        const yawTorque = c.steer * m * BOAT.steerTorque * speedFactor * dir * s;
        // bank into the turn like a real hull
        const bank = -c.steer * fwdSpeed * m * 0.045 * s;
        b.addTorque(
          { x: this.up.x * yawTorque + this.forward.x * bank, y: this.up.y * yawTorque + this.forward.y * bank, z: this.up.z * yawTorque + this.forward.z * bank },
          true,
        );
      }
    } else {
      this.airTime += dt;
      b.setAngularDamping(0.35);
      b.setLinearDamping(BOAT.airDrag);
      if (this.flipTimer > 0) {
        this.flipTimer -= dt;
        if (this.flipTimer <= 0) {
          // cancel flip spin so the boat lands flat
          b.setAngvel({ x: angvel.x * 0.25, y: angvel.y, z: angvel.z * 0.25 }, true);
        }
      } else if (this.demolished <= 0) {
        // air control (pitch / yaw / roll)
        const pitchT = c.pitch * m * BOAT.airPitch * 0.45;
        const yawT = c.steer * m * BOAT.airYaw * 0.55;
        const rollT = -c.roll * m * BOAT.airRoll * 0.45;
        b.addTorque(
          {
            x: this.right.x * pitchT + this.up.x * yawT + this.forward.x * rollT,
            y: this.right.y * pitchT + this.up.y * yawT + this.forward.y * rollT,
            z: this.right.z * pitchT + this.up.z * yawT + this.forward.z * rollT,
          },
          true,
        );
        // gentle auto-level after a long flight so bots (and casual players) land upright
        if (this.airTime > 1.4) {
          const cross = this.tmpV2.crossVectors(this.up, WORLD_UP);
          const k = m * 1.8;
          b.addTorque({ x: cross.x * k, y: cross.y * k, z: cross.z * k }, true);
        }
      }
    }

    // ---------------- jumping ----------------
    this.sinceJump += dt;
    this.jumpCooldown -= dt;
    if (c.jump && this.demolished <= 0) {
      if (this.inWater && this.jumpCooldown <= 0) {
        const dir = this.tmpV.copy(this.up).multiplyScalar(0.45).addScaledVector(WORLD_UP, 0.55).normalize();
        const j = m * BOAT.jumpSpeed * (0.8 + 0.2 * s);
        b.applyImpulse({ x: dir.x * j, y: dir.y * j, z: dir.z * j }, true);
        this.hasDoubleJump = true;
        this.sinceJump = 0;
        this.jumpCooldown = 0.3;
        this.inWater = false;
        fx.splash(this.position, 0.5, 1.6);
        fx.audio.jump(this.position);
      } else if (!this.inWater && this.hasDoubleJump && this.sinceJump < 1.6) {
        this.hasDoubleJump = false;
        const stick = Math.hypot(c.steer, c.throttle);
        if (stick > 0.35) {
          const fwdH = this.tmpV.set(this.forward.x, 0, this.forward.z).normalize();
          const rightH = this.tmpV2.set(this.right.x, 0, this.right.z).normalize();
          const dir = new THREE.Vector3().addScaledVector(fwdH, c.throttle).addScaledVector(rightH, c.steer).normalize();
          const jd = m * BOAT.dodgeSpeed;
          b.applyImpulse({ x: dir.x * jd, y: m * BOAT.dodgeUp, z: dir.z * jd }, true);
          this.flipAxis.crossVectors(WORLD_UP, dir).normalize();
          const spin = 7.5;
          b.setAngvel({ x: this.flipAxis.x * spin, y: av.y * 0.3, z: this.flipAxis.z * spin }, true);
          this.flipTimer = 0.62;
          fx.audio.dodge(this.position);
        } else {
          const j = m * BOAT.jumpSpeed * 0.8;
          b.applyImpulse({ x: 0, y: j, z: 0 }, true);
          fx.audio.jump(this.position);
        }
      }
    }

    // ---------------- boost ----------------
    this.boosting = false;
    if (c.boost && this.boost > 0 && this.demolished <= 0) {
      this.boosting = true;
      const used = Math.min(this.boost, BOAT.boostDrainPerSec * dt);
      this.boost -= used;
      this.stats.boostUsed += used;
      const dir = this.tmpV.copy(this.forward);
      if (this.inWater) dir.y = THREE.MathUtils.clamp(dir.y, -0.05, 0.3);
      dir.normalize();
      const f = m * BOAT.boostAccel;
      b.addForce({ x: dir.x * f, y: dir.y * f, z: dir.z * f }, true);
    }

    // ---------------- speed cap ----------------
    const maxV = this.boosting ? BOAT.maxBoostSpeed : BOAT.maxSpeed;
    const v = b.linvel();
    const sp = Math.hypot(v.x, v.y, v.z);
    if (sp > maxV) {
      const k = THREE.MathUtils.lerp(1, maxV / sp, 0.35);
      b.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
    }
    this.supersonic = sp > 30;

    // ---------------- effects ----------------
    if (this.inWater) {
      const hs = Math.hypot(this.velocity.x, this.velocity.z);
      // Continuous source: steady-state height ~ strength / (1 - damping), so keep this small
      // (≈0.1 m of hull depression at speed) or the sim saturates into a foam blob.
      fx.ripple.addEmitter(this.position.x, this.position.z, 1.1 + hs * 0.02, -0.0055 * THREE.MathUtils.clamp(hs / 10, 0.2, 1.4) * s);
      if (hs > 3) {
        const stern = this.tmpV.set(0, 0, -1.2).applyQuaternion(this.quaternion).add(this.position);
        const dir = this.tmpV2.set(this.velocity.x, 0, this.velocity.z).normalize();
        this.wake.push(stern.x, stern.y, stern.z, dir.x, dir.z);
      }
    }
    if (!this.prevInWater && this.inWater && this.velocity.y < -2.5) {
      fx.splash(this.position, Math.min(1.5, -this.velocity.y / 7), 1.8);
      this.punch(Math.min(0.4, -this.velocity.y * 0.04));
    }
    if (this.demolished > 0) this.demolished -= dt;
  }

  /** Squash-and-stretch impulse for impacts. */
  punch(amount: number) {
    this.squishVel += amount * 12;
  }

  /** Visual update (every rendered frame). alpha blends the previous and current physics states. */
  update(dt: number, time: number, alpha: number, lookAt: THREE.Vector3, fx: FxContext) {
    const v = this.visual;
    v.root.position.lerpVectors(this.prevPos, this.position, alpha);
    v.root.quaternion.slerpQuaternions(this.prevQuat, this.quaternion, alpha);

    // squash & stretch spring
    const k = 120;
    const dmp = 9;
    this.squishVel += (-k * this.squish - dmp * this.squishVel) * dt;
    this.squish += this.squishVel * dt;
    const sq = THREE.MathUtils.clamp(this.squish, -0.35, 0.35);
    v.body.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);

    // propeller & motor
    const spin = 6 + Math.abs(this.controls.throttle) * 45 + (this.boosting ? 50 : 0);
    v.propeller.rotation.z += spin * dt;
    this.motorYaw += (-this.controls.steer * 0.55 - this.motorYaw) * Math.min(1, dt * 10);
    v.motor.rotation.y = this.motorYaw;

    // eyes follow the ball, blink now and then
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.16;
      this.blinkTimer = 2.5 + Math.random() * 4;
    }
    this.blink = Math.max(0, this.blink - dt);
    const eyeScaleY = this.blink > 0 ? 0.12 : 1;
    this.lookTarget.copy(lookAt);
    v.root.worldToLocal(this.lookTarget);
    for (let i = 0; i < v.eyes.length; i++) {
      const eye = v.eyes[i];
      eye.scale.y += (eyeScaleY - eye.scale.y) * Math.min(1, dt * 30);
      const dir = this.tmpV.copy(this.lookTarget).sub(eye.position).normalize();
      const pupil = v.pupils[i];
      pupil.position.x = THREE.MathUtils.clamp(dir.x * 0.1, -0.09, 0.09);
      pupil.position.y = 0.02 + THREE.MathUtils.clamp(dir.y * 0.08, -0.07, 0.07);
    }

    // flag cloth
    const fp = v.flag.geometry.attributes.position as THREE.BufferAttribute;
    const base = v.flagBase;
    const wind = 6 + this.speed * 0.5;
    for (let i = 0; i < fp.count; i++) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      const w = Math.sin(time * wind + x * 9) * 0.06 * x + Math.sin(time * wind * 1.7 + y * 6) * 0.02 * x;
      fp.setXYZ(i, x, y, w);
    }
    fp.needsUpdate = true;

    // boost flame
    this.flameFlicker += dt * 40;
    v.boostFlame.visible = this.boosting;
    v.boostGlow.visible = this.boosting;
    if (this.boosting) {
      const f = 0.85 + Math.sin(this.flameFlicker) * 0.15 + Math.random() * 0.1;
      v.boostFlame.scale.set(f, 0.9 + Math.random() * 0.5, f);
      v.boostGlow.scale.setScalar(f);
      const back = this.tmpV.copy(this.forward).negate();
      const nozzle = this.tmpV2.set(0, -0.1, -2.0).applyQuaternion(this.quaternion).add(this.position);
      fx.boostTrail(nozzle, back, new THREE.Color(TEAM_COLORS[this.team].accent), this.inWater);
    }
    if (this.inWater && this.speed > 9) {
      const bow = this.tmpV2.set(0, -0.1, 1.2).applyQuaternion(this.quaternion).add(this.position);
      fx.hullSpray(bow, this.velocity, this.speed);
    }

    this.wake.update(dt, time);
    v.tubeMaterial.emissive.setHex(this.demolished > 0 ? 0x220000 : 0x000000);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.visual.root);
    scene.remove(this.wake.mesh);
  }
}
