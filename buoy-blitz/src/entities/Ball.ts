import * as THREE from 'three';
import { ARENA, BALL, GRAVITY } from '../config';
import { Physics, RAPIER } from '../physics/Physics';
import { waterHeightAt } from '../water/WaveModel';
import { makeBallTexture } from '../render/ProceduralTextures';
import { OVERLAY_LAYER } from '../render/GameRenderer';
import { Trail, makeTrailMaterial } from '../fx/Trail';
import type { FxContext } from '../fx/FxContext';

export interface BallShape {
  id: string;
  name: string;
  icon: string;
  boundRadius: number;
  geometry: () => THREE.BufferGeometry;
  collider: () => RAPIER.ColliderDesc;
}

const R = BALL.radius;

function hullFromGeometry(geo: THREE.BufferGeometry): RAPIER.ColliderDesc {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const pts = new Float32Array(pos.array);
  const desc = RAPIER.ColliderDesc.convexHull(pts);
  if (!desc) throw new Error('convex hull failed');
  return desc;
}

export const BALL_SHAPES: BallShape[] = [
  {
    id: 'sphere',
    name: 'Sphere',
    icon: '●',
    boundRadius: R,
    geometry: () => new THREE.SphereGeometry(R, 48, 32),
    collider: () => RAPIER.ColliderDesc.ball(R),
  },
  {
    id: 'cube',
    name: 'Cube',
    icon: '■',
    boundRadius: R * 0.82 * Math.SQRT2,
    geometry: () => new THREE.BoxGeometry(R * 1.64, R * 1.64, R * 1.64, 4, 4, 4),
    collider: () => RAPIER.ColliderDesc.roundCuboid(R * 0.78, R * 0.78, R * 0.78, 0.04),
  },
  {
    id: 'capsule',
    name: 'Capsule',
    icon: '⬭',
    boundRadius: R * 1.15,
    geometry: () => new THREE.CapsuleGeometry(R * 0.72, R * 0.9, 12, 32),
    collider: () => RAPIER.ColliderDesc.capsule(R * 0.45, R * 0.72),
  },
  {
    id: 'cylinder',
    name: 'Puck',
    icon: '⬬',
    boundRadius: R * 1.1,
    geometry: () => new THREE.CylinderGeometry(R * 0.95, R * 0.95, R * 1.1, 40, 1),
    collider: () => RAPIER.ColliderDesc.cylinder(R * 0.55, R * 0.95),
  },
  {
    id: 'icosahedron',
    name: 'D20',
    icon: '⬢',
    boundRadius: R * 1.1,
    geometry: () => new THREE.IcosahedronGeometry(R * 1.1, 0),
    collider: () => hullFromGeometry(new THREE.IcosahedronGeometry(R * 1.1, 0)),
  },
  {
    id: 'octahedron',
    name: 'Gem',
    icon: '◆',
    boundRadius: R * 1.25,
    geometry: () => new THREE.OctahedronGeometry(R * 1.25, 0),
    collider: () => hullFromGeometry(new THREE.OctahedronGeometry(R * 1.25, 0)),
  },
  {
    id: 'cone',
    name: 'Cone',
    icon: '▲',
    boundRadius: R * 1.15,
    geometry: () => new THREE.ConeGeometry(R * 0.95, R * 2.0, 36, 1),
    collider: () => RAPIER.ColliderDesc.cone(R * 1.0, R * 0.95),
  },
  {
    id: 'egg',
    name: 'Egg',
    icon: '⬯',
    boundRadius: R * 1.25,
    geometry: () => {
      const g = new THREE.SphereGeometry(R * 0.9, 40, 28);
      g.scale(1, 1.38, 1);
      return g;
    },
    collider: () => {
      const g = new THREE.SphereGeometry(R * 0.9, 16, 10);
      g.scale(1, 1.38, 1);
      return hullFromGeometry(g);
    },
  },
  {
    id: 'donut',
    name: 'Donut',
    icon: '◎',
    boundRadius: R * 1.2,
    geometry: () => new THREE.TorusGeometry(R * 0.78, R * 0.42, 20, 40),
    collider: () => hullFromGeometry(new THREE.TorusGeometry(R * 0.78, R * 0.42, 6, 16)),
  },
  {
    id: 'star',
    name: 'Star',
    icon: '★',
    boundRadius: R * 1.3,
    geometry: () => new THREE.DodecahedronGeometry(R * 1.15, 0),
    collider: () => hullFromGeometry(new THREE.DodecahedronGeometry(R * 1.15, 0)),
  },
];

export class Ball {
  readonly body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  readonly mesh: THREE.Mesh;
  readonly shadowRing: THREE.Mesh;
  readonly trail: Trail;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  shape: BallShape = BALL_SHAPES[0];
  submerged = 0;
  lastTouchBoat = -1;
  lastTouchTeam = -1;
  lastTouchTime = -99;

  private prevPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private morphT = -1; // -1 idle, else 0..1 progress
  private pendingShape: BallShape | null = null;
  private scaleSpring = 1;
  private scaleVel = 0;
  private wasSubmerged = false;
  private physics: Physics;
  private tmp = new THREE.Vector3();

  constructor(physics: Physics, scene: THREE.Scene) {
    this.physics = physics;
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2, 0).setLinearDamping(0.02).setAngularDamping(0.4).setCcdEnabled(true);
    this.body = physics.world.createRigidBody(desc);
    this.collider = this.createCollider(this.shape);

    const tex = makeBallTexture();
    const mat = new THREE.MeshPhysicalMaterial({
      map: tex,
      roughness: 0.28,
      metalness: 0.0,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
      emissive: 0x000000,
    });
    this.mesh = new THREE.Mesh(this.shape.geometry(), mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    const ringMat = new THREE.MeshBasicMaterial({ color: 0x0b2a40, transparent: true, opacity: 0.35, depthWrite: false });
    this.shadowRing = new THREE.Mesh(new THREE.RingGeometry(R * 0.55, R * 1.05, 40), ringMat);
    this.shadowRing.rotation.x = -Math.PI / 2;
    this.shadowRing.layers.set(OVERLAY_LAYER);
    this.shadowRing.renderOrder = 12;
    scene.add(this.shadowRing);

    const trailTex = new THREE.CanvasTexture(makeTrailCanvas());
    this.trail = new Trail({
      maxPoints: 40,
      life: 0.6,
      startWidth: R * 1.3,
      endWidth: R * 0.2,
      onSurface: false,
      minSpacing: 0.4,
      material: makeTrailMaterial(trailTex, new THREE.Color(0.7, 0.9, 1.0), true, 0.55),
    });
    scene.add(this.trail.mesh);
  }

  private createCollider(shape: BallShape): RAPIER.Collider {
    const desc = shape
      .collider()
      .setMass(BALL.mass)
      .setRestitution(BALL.restitution)
      .setFriction(BALL.friction)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const col = this.physics.world.createCollider(desc, this.body);
    this.physics.register(col, { kind: 'ball' });
    return col;
  }

  reset(x = 0, y = 2.5, z = 0) {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.lastTouchBoat = -1;
    this.lastTouchTeam = -1;
    this.trail.clear();
    this.sync();
    this.prevPos.copy(this.position);
    this.prevQuat.copy(this.quaternion);
  }

  /** Start a squash-pop transition into a new shape. */
  morphTo(shape: BallShape) {
    if (shape.id === this.shape.id) return;
    this.pendingShape = shape;
    this.morphT = 0;
  }

  private applyPendingShape(fx: FxContext) {
    if (!this.pendingShape) return;
    const shape = this.pendingShape;
    this.pendingShape = null;
    this.physics.unregister(this.collider);
    this.physics.world.removeCollider(this.collider, true);
    this.shape = shape;
    this.collider = this.createCollider(shape);
    this.mesh.geometry.dispose();
    this.mesh.geometry = shape.geometry();
    this.scaleSpring = 0.55;
    this.scaleVel = 6;
    fx.burst(this.position, new THREE.Color(1, 0.9, 0.5), 50, 7);
    fx.audio.morph(this.position);
    // keep it from getting stuck in the floor/walls after a size change
    const p = this.body.translation();
    if (p.y < shape.boundRadius - 1) this.body.setTranslation({ x: p.x, y: shape.boundRadius - 0.5, z: p.z }, true);
  }

  private sync() {
    const p = this.body.translation();
    const r = this.body.rotation();
    const v = this.body.linvel();
    this.position.set(p.x, p.y, p.z);
    this.quaternion.set(r.x, r.y, r.z, r.w);
    this.velocity.set(v.x, v.y, v.z);
  }

  fixedUpdate(dt: number, time: number, fx: FxContext) {
    this.prevPos.copy(this.position);
    this.prevQuat.copy(this.quaternion);
    const b = this.body;
    b.resetForces(false);
    b.resetTorques(false);
    this.sync();

    // out-of-bounds safety
    if (
      Math.abs(this.position.x) > ARENA.width / 2 + 4 ||
      Math.abs(this.position.z) > ARENA.length / 2 + ARENA.goalDepth + 4 ||
      this.position.y < ARENA.floorY - 2 ||
      this.position.y > ARENA.wallHeight + 8
    ) {
      this.reset();
      return;
    }

    // ---------------- buoyancy (volume approximation) ----------------
    const rb = this.shape.boundRadius * 0.9;
    const h = waterHeightAt(this.position.x, this.position.z, time);
    const bottom = this.position.y - rb;
    const depth = h - bottom;
    const f = THREE.MathUtils.clamp(depth / (2 * rb), 0, 1);
    this.submerged = f;
    const m = BALL.mass;
    if (f > 0) {
      // linear Archimedes term plus a strong extra push when the ball is driven deep under the surface,
      // so a beach ball pops back up quickly instead of sinking out of play
      const deep = THREE.MathUtils.clamp((h - this.position.y) / rb, 0, 4);
      const lift = (m * GRAVITY * f) / BALL.restSubmersion + m * GRAVITY * deep * 1.6;
      const dampCoeff = this.velocity.y < 0 ? 2.4 : 0.7;
      const damp = -m * dampCoeff * this.velocity.y * f;
      // buoyancy acts at the centre of the submerged cap, a little below the ball centre
      const cob = this.tmp.set(this.position.x, this.position.y - rb * 0.35 * (1 - f), this.position.z);
      b.addForceAtPoint({ x: 0, y: lift + damp, z: 0 }, { x: cob.x, y: cob.y, z: cob.z }, true);
      const drag = m * 0.45 * f;
      b.addForce({ x: -this.velocity.x * drag, y: 0, z: -this.velocity.z * drag }, true);
      b.setAngularDamping(0.4 + 1.6 * f);
      // gentle wave push
      const hx = waterHeightAt(this.position.x + 0.5, this.position.z, time) - waterHeightAt(this.position.x - 0.5, this.position.z, time);
      const hz = waterHeightAt(this.position.x, this.position.z + 0.5, time) - waterHeightAt(this.position.x, this.position.z - 0.5, time);
      b.addForce({ x: -hx * m * 2.5 * f, y: 0, z: -hz * m * 2.5 * f }, true);
      const hs = Math.hypot(this.velocity.x, this.velocity.z);
      fx.ripple.addEmitter(this.position.x, this.position.z, rb * 0.9, -0.005 * f * THREE.MathUtils.clamp(hs / 6, 0.3, 1.5));
    } else {
      b.setAngularDamping(0.25);
    }
    const nowSubmerged = f > 0.02;
    if (nowSubmerged && !this.wasSubmerged && this.velocity.y < -2) {
      fx.splash(this.position, Math.min(1.6, -this.velocity.y / 6), rb * 1.4);
      this.scaleVel -= Math.min(3, -this.velocity.y * 0.25);
    }
    this.wasSubmerged = nowSubmerged;

    // morph timeline (squash, swap, pop)
    if (this.morphT >= 0) {
      this.morphT += dt / 0.28;
      if (this.morphT >= 0.5 && this.pendingShape) this.applyPendingShape(fx);
      if (this.morphT >= 1) this.morphT = -1;
    }
  }

  /** Called when a boat hits the ball: Rocket-League-style extra impulse. */
  applyHitBoost(boatPos: THREE.Vector3, boatVel: THREE.Vector3, boatId: number, team: number, time: number) {
    const dir = this.tmp.subVectors(this.position, boatPos);
    dir.y *= 0.55;
    if (dir.lengthSq() < 1e-4) return;
    dir.normalize();
    const relSpeed = Math.max(0, boatVel.dot(dir));
    const impulse = relSpeed * BALL.hitBoostFactor + 20;
    this.body.applyImpulse({ x: dir.x * impulse, y: dir.y * impulse + 8, z: dir.z * impulse }, true);
    this.lastTouchBoat = boatId;
    this.lastTouchTeam = team;
    this.lastTouchTime = time;
    this.scaleVel -= 2.5;
  }

  update(dt: number, time: number, alpha: number) {
    this.mesh.position.lerpVectors(this.prevPos, this.position, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevQuat, this.quaternion, alpha);
    // pop spring
    this.scaleVel += (-160 * (this.scaleSpring - 1) - 10 * this.scaleVel) * dt;
    this.scaleSpring += this.scaleVel * dt;
    let sx = this.scaleSpring;
    let sy = this.scaleSpring;
    if (this.morphT >= 0 && this.morphT < 0.5) {
      const t = this.morphT / 0.5;
      sy *= 1 - 0.45 * Math.sin(t * Math.PI);
      sx *= 1 + 0.25 * Math.sin(t * Math.PI);
    }
    this.mesh.scale.set(sx, sy, sx);

    const speed = this.velocity.length();
    const mat = this.mesh.material as THREE.MeshPhysicalMaterial;
    const glow = THREE.MathUtils.clamp((speed - 14) / 20, 0, 1);
    mat.emissive.setRGB(0.4 * glow, 0.7 * glow, 1.0 * glow);
    mat.emissiveIntensity = 0.6;

    // surface marker under the ball
    const h = waterHeightAt(this.position.x, this.position.z, time);
    this.shadowRing.position.set(this.mesh.position.x, h + 0.05, this.mesh.position.z);
    const height = Math.max(0, this.position.y - h);
    const rs = 1 + height * 0.06;
    this.shadowRing.scale.set(rs, rs, rs);
    (this.shadowRing.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(0.42 - height * 0.012, 0.12, 0.42);
    this.shadowRing.visible = height > 0.3;

    if (speed > 13) {
      const dir = this.tmp.copy(this.velocity).normalize();
      this.trail.push(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z, dir.x, dir.z);
    }
    this.trail.update(dt, time);
  }
}

function makeTrailCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}
