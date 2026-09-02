import * as THREE from 'three';
import { ARENA, BALL, TEAM_COLORS, type Team } from '../config';
import { Physics, RAPIER } from '../physics/Physics';
import { makeBumperTexture, makeGlassPanelTexture, makeNetTexture, makePoolFloorTexture, makeSandTexture } from '../render/ProceduralTextures';
import { makeCausticsMaterial, updateCaustics } from './CausticsMaterial';

const W2 = ARENA.width / 2;
const L2 = ARENA.length / 2;
const H = ARENA.wallHeight;
const FY = ARENA.floorY;
const GW2 = ARENA.goalWidth / 2;
const GH = ARENA.goalHeight;
const GD = ARENA.goalDepth;
const C = ARENA.cornerCut;

export class Arena {
  readonly group = new THREE.Group();
  readonly goalSensors: [RAPIER.Collider, RAPIER.Collider];
  private animated: THREE.Material[] = [];
  private neon: THREE.MeshStandardMaterial;
  private goalGlow: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];

  constructor(physics: Physics, scene: THREE.Scene) {
    const world = physics.world;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    const wall = (hx: number, hy: number, hz: number, x: number, y: number, z: number, rotY = 0) => {
      const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRestitution(0.45).setFriction(0.25);
      if (rotY !== 0) {
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
        desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      }
      const col = world.createCollider(desc, body);
      physics.register(col, { kind: 'wall' });
      return col;
    };

    const wallHy = (H - FY) / 2 + 2;
    const wallCy = (H + FY) / 2;
    // side walls
    wall(0.5, wallHy, L2 + 1, W2 + 0.5, wallCy, 0);
    wall(0.5, wallHy, L2 + 1, -(W2 + 0.5), wallCy, 0);
    // end walls with goal openings
    for (const s of [1, -1]) {
      const z = s * (L2 + 0.5);
      const segHx = (W2 - GW2) / 2;
      wall(segHx, wallHy, 0.5, GW2 + segHx, wallCy, z);
      wall(segHx, wallHy, 0.5, -(GW2 + segHx), wallCy, z);
      wall(GW2 + 0.2, (H - GH) / 2 + 2, 0.5, 0, (H + GH) / 2 + 2, z);
      // goal box
      const gz = s * (L2 + GD / 2);
      wall(GW2 + 1, (GH - FY) / 2 + 1, 0.5, 0, (GH + FY) / 2, s * (L2 + GD + 0.5));
      wall(0.5, (GH - FY) / 2 + 1, GD / 2 + 0.5, GW2 + 0.5, (GH + FY) / 2, gz);
      wall(0.5, (GH - FY) / 2 + 1, GD / 2 + 0.5, -(GW2 + 0.5), (GH + FY) / 2, gz);
      wall(GW2 + 1, 0.5, GD / 2 + 0.5, 0, GH + 0.5, gz);
    }
    // corners at 45 degrees
    const cLen = C * Math.SQRT2;
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        const cx = sx * (W2 - C / 2);
        const cz = sz * (L2 - C / 2);
        // rotation about +Y maps local +X to (cos r, 0, -sin r); the cut in the (+x,+z) corner runs along (1, 0, -1)
        const rot = sx * sz > 0 ? Math.PI / 4 : -Math.PI / 4;
        wall(cLen / 2 + 0.6, wallHy, 0.5, cx + sx * 0.35, wallCy, cz + sz * 0.35, rot);
      }
    }
    // ceiling and floor
    wall(W2 + 4, 0.5, L2 + GD + 4, 0, H + 0.5, 0);
    wall(W2 + 4, 0.5, L2 + GD + 4, 0, FY - 0.5, 0);

    // goal sensors: the whole ball must cross the line
    const sensorStart = 2 * BALL.radius;
    const sensors: RAPIER.Collider[] = [];
    for (const s of [1, -1]) {
      const zStart = L2 + sensorStart;
      const zEnd = L2 + GD;
      const desc = RAPIER.ColliderDesc.cuboid(GW2, (GH - FY) / 2, (zEnd - zStart) / 2)
        .setTranslation(0, (GH + FY) / 2, s * (zStart + zEnd) / 2)
        .setSensor(true);
      const col = world.createCollider(desc, body);
      const team: Team = s > 0 ? 1 : 0; // goal at +Z belongs to orange (team 1)
      physics.register(col, { kind: 'goal', team });
      sensors.push(col);
    }
    this.goalSensors = [sensors[1], sensors[0]]; // index by defending team: [blue goal (-Z), orange goal (+Z)]

    // ---------------- visuals ----------------
    this.neon = new THREE.MeshStandardMaterial({ color: 0x9be8ff, emissive: 0x7fdcff, emissiveIntensity: 2.2, roughness: 0.4, metalness: 0.1 });
    this.goalGlow = [
      new THREE.MeshStandardMaterial({ color: TEAM_COLORS[0].main, emissive: TEAM_COLORS[0].main, emissiveIntensity: 2.4, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: TEAM_COLORS[1].main, emissive: TEAM_COLORS[1].main, emissiveIntensity: 2.4, roughness: 0.4 }),
    ];

    this.buildFloor();
    this.buildGlassWalls();
    this.buildBumpers();
    this.buildGoals();
    scene.add(this.group);
  }

  private buildFloor() {
    const tileTex = makePoolFloorTexture(ARENA.width, ARENA.length + 2 * GD, TEAM_COLORS[0].main, TEAM_COLORS[1].main);
    const floorMat = makeCausticsMaterial({ map: tileTex, roughness: 0.55, metalness: 0.0, color: 0xffffff }, 0.8, 0.3);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.width, ARENA.length + 2 * GD), floorMat);
    floor.rotation.x = -Math.PI / 2; // texture top (blue box) faces -Z
    floor.position.y = FY;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.animated.push(floorMat);

    const sandTex = makeSandTexture();
    sandTex.repeat.set(160, 160);
    const sandMat = makeCausticsMaterial({ map: sandTex, roughness: 0.95, color: 0xc9b58e }, 0.5, 0.22);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), sandMat);
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = FY - 0.06;
    sand.receiveShadow = true;
    this.group.add(sand);
    this.animated.push(sandMat);

    // shallow ledge around the pool so the arena reads as a structure in the sea
    const ledgeMat = new THREE.MeshStandardMaterial({ color: 0xe8f1f5, roughness: 0.6 });
    const ledgeShape = new THREE.Shape();
    const ow = W2 + 3.5;
    const ol = L2 + GD + 3.5;
    ledgeShape.moveTo(-ow, -ol);
    ledgeShape.lineTo(ow, -ol);
    ledgeShape.lineTo(ow, ol);
    ledgeShape.lineTo(-ow, ol);
    ledgeShape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-W2 - 0.9, -L2 - GD - 0.9);
    hole.lineTo(W2 + 0.9, -L2 - GD - 0.9);
    hole.lineTo(W2 + 0.9, L2 + GD + 0.9);
    hole.lineTo(-W2 - 0.9, L2 + GD + 0.9);
    hole.closePath();
    ledgeShape.holes.push(hole);
    const ledge = new THREE.Mesh(new THREE.ExtrudeGeometry(ledgeShape, { depth: 1.6, bevelEnabled: false }), ledgeMat);
    ledge.rotation.x = Math.PI / 2;
    ledge.position.y = 0.32;
    ledge.receiveShadow = true;
    ledge.castShadow = true;
    this.group.add(ledge);
  }

  private buildGlassWalls() {
    const panelTex = makeGlassPanelTexture();
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xcfeeff,
      transparent: true,
      opacity: 0.12,
      roughness: 0.08,
      metalness: 0.0,
      map: panelTex,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 0.6,
    });
    const wallH = H - 0.4;
    const wallCy = 0.4 + wallH / 2;
    const addPanel = (w: number, x: number, z: number, rotY: number) => {
      const geo = new THREE.PlaneGeometry(w, wallH);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 5), uv.getY(i) * (wallH / 5));
      const m = new THREE.Mesh(geo, glass);
      m.position.set(x, wallCy, z);
      m.rotation.y = rotY;
      m.renderOrder = 5;
      this.group.add(m);
      // neon rim along the top edge
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, 0.18), this.neon);
      rim.position.set(x, H - 0.3, z);
      rim.rotation.y = rotY;
      this.group.add(rim);
    };
    // side walls (minus corners)
    const sideLen = ARENA.length - 2 * C;
    addPanel(sideLen, W2, 0, -Math.PI / 2);
    addPanel(sideLen, -W2, 0, Math.PI / 2);
    // corners
    const cLen = C * Math.SQRT2;
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        const rot = sx * sz > 0 ? Math.PI / 4 : -Math.PI / 4;
        addPanel(cLen, sx * (W2 - C / 2), sz * (L2 - C / 2), rot);
      }
    }
    // end walls with goal opening
    for (const s of [1, -1]) {
      const segW = W2 - C - GW2;
      const rot = s > 0 ? Math.PI : 0;
      addPanel(segW, GW2 + segW / 2, s * L2, rot);
      addPanel(segW, -(GW2 + segW / 2), s * L2, rot);
      // panel above the goal
      const topH = H - 0.4 - GH;
      const geo = new THREE.PlaneGeometry(ARENA.goalWidth, topH);
      const m = new THREE.Mesh(geo, glass);
      m.position.set(0, GH + topH / 2, s * L2);
      m.rotation.y = rot;
      m.renderOrder = 5;
      this.group.add(m);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(ARENA.goalWidth, 0.18, 0.18), this.neon);
      rim.position.set(0, H - 0.3, s * L2);
      this.group.add(rim);
    }
    // vertical neon posts at the panel joints
    const postGeo = new THREE.BoxGeometry(0.16, wallH, 0.16);
    const joints: [number, number][] = [
      [W2, L2 - C], [W2, -(L2 - C)], [-W2, L2 - C], [-W2, -(L2 - C)],
      [W2 - C, L2], [-(W2 - C), L2], [W2 - C, -L2], [-(W2 - C), -L2],
    ];
    for (const [x, z] of joints) {
      const p = new THREE.Mesh(postGeo, this.neon);
      p.position.set(x, wallCy, z);
      this.group.add(p);
    }
  }

  private buildBumpers() {
    const tex = makeBumperTexture();
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.25 });
    const radius = 0.55;
    const y = 0.12;
    const inset = 0.8;
    const ow = W2 - inset;
    const ol = L2 - inset;
    const c = C - inset * 0.4;
    const segs: [THREE.Vector3, THREE.Vector3][] = [];
    const P = (x: number, z: number) => new THREE.Vector3(x, y, z);
    // sides
    segs.push([P(ow, -(ol - c)), P(ow, ol - c)]);
    segs.push([P(-ow, -(ol - c)), P(-ow, ol - c)]);
    // corners
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        segs.push([P(sx * ow, sz * (ol - c)), P(sx * (ow - c), sz * ol)]);
      }
    }
    // end pieces beside the goals
    for (const s of [1, -1]) {
      segs.push([P(ow - c, s * ol), P(GW2 + 0.9, s * ol)]);
      segs.push([P(-(ow - c), s * ol), P(-(GW2 + 0.9), s * ol)]);
    }
    const capGeo = new THREE.SphereGeometry(radius, 16, 12);
    for (const [a, b] of segs) {
      const curve = new THREE.LineCurve3(a, b);
      const len = a.distanceTo(b);
      const geo = new THREE.TubeGeometry(curve, 2, radius, 18, false);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 4));
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      this.group.add(m);
      for (const p of [a, b]) {
        const cap = new THREE.Mesh(capGeo, mat);
        cap.position.copy(p);
        this.group.add(cap);
      }
    }
  }

  private buildGoals() {
    const netTex = makeNetTexture();
    const netMat = new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, roughness: 0.9, color: 0xffffff });
    for (const s of [1, -1]) {
      const team: Team = s > 0 ? 1 : 0;
      const glow = this.goalGlow[team];
      const beam = 0.35;
      const z0 = s * L2;
      const z1 = s * (L2 + GD);
      // frame: crossbar, posts, depth beams
      const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
        const m = new THREE.Mesh(geo, glow);
        m.position.set(x, y, z);
        m.castShadow = true;
        this.group.add(m);
      };
      add(new THREE.BoxGeometry(ARENA.goalWidth + beam, beam, beam), 0, GH, z0);
      add(new THREE.BoxGeometry(beam, GH + 0.6, beam), GW2, GH / 2 - 0.3, z0);
      add(new THREE.BoxGeometry(beam, GH + 0.6, beam), -GW2, GH / 2 - 0.3, z0);
      add(new THREE.BoxGeometry(beam, beam, GD), GW2, GH, (z0 + z1) / 2);
      add(new THREE.BoxGeometry(beam, beam, GD), -GW2, GH, (z0 + z1) / 2);
      add(new THREE.BoxGeometry(ARENA.goalWidth + beam, beam, beam), 0, GH, z1);
      add(new THREE.BoxGeometry(beam, GH + 0.6, beam), GW2, GH / 2 - 0.3, z1);
      add(new THREE.BoxGeometry(beam, GH + 0.6, beam), -GW2, GH / 2 - 0.3, z1);
      // nets
      const netH = GH + 0.6;
      const back = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.goalWidth, netH), netMat);
      back.position.set(0, GH / 2 - 0.3, z1 - s * 0.1);
      (back.geometry.attributes.uv as THREE.BufferAttribute).array.forEach((_, i, arr) => {
        arr[i] *= i % 2 === 0 ? ARENA.goalWidth / 2 : netH / 2;
      });
      this.group.add(back);
      for (const sx of [1, -1]) {
        const side = new THREE.Mesh(new THREE.PlaneGeometry(GD, netH), netMat);
        side.position.set(sx * (GW2 - 0.1), GH / 2 - 0.3, (z0 + z1) / 2);
        side.rotation.y = Math.PI / 2;
        (side.geometry.attributes.uv as THREE.BufferAttribute).array.forEach((_, i, arr) => {
          arr[i] *= i % 2 === 0 ? GD / 2 : netH / 2;
        });
        this.group.add(side);
      }
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.goalWidth, GD), netMat);
      roof.position.set(0, GH - 0.1, (z0 + z1) / 2);
      roof.rotation.x = -Math.PI / 2;
      (roof.geometry.attributes.uv as THREE.BufferAttribute).array.forEach((_, i, arr) => {
        arr[i] *= i % 2 === 0 ? ARENA.goalWidth / 2 : GD / 2;
      });
      this.group.add(roof);
      // glowing goal line on the floor
      const line = new THREE.Mesh(new THREE.BoxGeometry(ARENA.goalWidth, 0.1, 0.5), glow);
      line.position.set(0, FY + 0.06, z0);
      this.group.add(line);
    }
  }

  /** Pulse the goal frame of the team that got scored on. */
  flashGoal(team: Team, amount: number) {
    this.goalGlow[team].emissiveIntensity = 2.4 + amount * 6;
  }

  update(time: number, dt: number) {
    for (const m of this.animated) updateCaustics(m, time);
    for (const g of this.goalGlow) g.emissiveIntensity += (2.4 - g.emissiveIntensity) * Math.min(1, dt * 3);
    this.neon.emissiveIntensity = 2.0 + Math.sin(time * 1.5) * 0.3;
  }
}
