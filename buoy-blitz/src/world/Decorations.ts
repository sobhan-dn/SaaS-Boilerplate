import * as THREE from 'three';
import { ARENA, TEAM_COLORS } from '../config';
import { waterHeightAt, waterNormalAt } from '../water/WaveModel';

interface Floater {
  obj: THREE.Object3D;
  x: number;
  z: number;
  phase: number;
  yaw: number;
  bob: number;
}

/** Rubber-duck crowd, light buoys and a few distant islands so the arena sits in a living sea. */
export class Decorations {
  readonly group = new THREE.Group();
  private floaters: Floater[] = [];
  private normal = { x: 0, y: 1, z: 0 };
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private n = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const duckYellow = new THREE.MeshPhysicalMaterial({ color: 0xffd23f, roughness: 0.35, clearcoat: 0.6 });
    const duckBlue = new THREE.MeshPhysicalMaterial({ color: TEAM_COLORS[0].main, roughness: 0.35, clearcoat: 0.6 });
    const duckOrange = new THREE.MeshPhysicalMaterial({ color: TEAM_COLORS[1].main, roughness: 0.35, clearcoat: 0.6 });
    const beak = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });

    const bodyGeo = new THREE.SphereGeometry(1, 20, 14);
    const headGeo = new THREE.SphereGeometry(0.62, 18, 12);
    const beakGeo = new THREE.ConeGeometry(0.22, 0.5, 10);
    const eyeGeo = new THREE.SphereGeometry(0.08, 8, 6);

    const makeDuck = (mat: THREE.Material, scale: number) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, mat);
      body.scale.set(1.1, 0.8, 1.35);
      body.castShadow = true;
      g.add(body);
      const head = new THREE.Mesh(headGeo, mat);
      head.position.set(0, 0.85, 0.75);
      head.castShadow = true;
      g.add(head);
      const b = new THREE.Mesh(beakGeo, beak);
      b.position.set(0, 0.75, 1.35);
      b.rotation.x = Math.PI / 2;
      g.add(b);
      for (const sx of [1, -1]) {
        const e = new THREE.Mesh(eyeGeo, eye);
        e.position.set(sx * 0.3, 1.0, 1.2);
        g.add(e);
      }
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 10), mat);
      tail.position.set(0, 0.3, -1.4);
      tail.rotation.x = -Math.PI / 2 - 0.6;
      g.add(tail);
      g.scale.setScalar(scale);
      return g;
    };

    // ring of spectators around the arena on the ledge side of the sea
    const rx = ARENA.width / 2 + 10;
    const rz = ARENA.length / 2 + ARENA.goalDepth + 10;
    const count = 34;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.1;
      const spread = 1 + Math.random() * 0.5;
      const x = Math.cos(a) * rx * spread + (Math.random() - 0.5) * 4;
      const z = Math.sin(a) * rz * spread + (Math.random() - 0.5) * 4;
      const mat = Math.random() < 0.5 ? duckYellow : z < 0 ? duckBlue : duckOrange;
      const duck = makeDuck(mat, 0.8 + Math.random() * 0.9);
      const yaw = Math.atan2(-x, -z) + (Math.random() - 0.5) * 0.6;
      this.group.add(duck);
      this.floaters.push({ obj: duck, x, z, phase: Math.random() * 10, yaw, bob: 0 });
    }

    // light buoys
    const buoyMat = new THREE.MeshStandardMaterial({ color: 0xe8352b, roughness: 0.5 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.5 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff4c0, emissive: 0xffe08a, emissiveIntensity: 3 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const x = Math.cos(a) * (rx + 26 + Math.random() * 15);
      const z = Math.sin(a) * (rz + 26 + Math.random() * 15);
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.1, 1.2, 16), buoyMat);
      g.add(base);
      const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 1.0, 16), whiteMat);
      mid.position.y = 1.1;
      g.add(mid);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3, 8), whiteMat);
      mast.position.y = 3;
      g.add(mast);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), lampMat);
      lamp.position.y = 4.6;
      g.add(lamp);
      this.group.add(g);
      this.floaters.push({ obj: g, x, z, phase: Math.random() * 10, yaw: Math.random() * 6, bob: 0 });
    }

    // distant islands
    const islandMat = new THREE.MeshStandardMaterial({ color: 0x3f7a4a, roughness: 0.95 });
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xd9c89a, roughness: 0.95 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.9 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.7;
      const d = 380 + Math.random() * 300;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const s = 25 + Math.random() * 45;
      const g = new THREE.Group();
      const sand = new THREE.Mesh(new THREE.ConeGeometry(s * 1.4, 6, 24), sandMat);
      sand.position.y = -2;
      g.add(sand);
      const hill = new THREE.Mesh(new THREE.ConeGeometry(s, s * (0.5 + Math.random() * 0.5), 20), islandMat);
      hill.position.y = 0;
      g.add(hill);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s * 0.35, 0), rockMat);
      rock.position.set(s * 0.6, 2, s * 0.2);
      g.add(rock);
      g.position.set(x, 0, z);
      this.group.add(g);
    }

    scene.add(this.group);
  }

  update(time: number) {
    for (const f of this.floaters) {
      const h = waterHeightAt(f.x, f.z, time);
      f.obj.position.set(f.x, h + 0.15, f.z);
      waterNormalAt(f.x, f.z, time, this.normal);
      this.n.set(this.normal.x, this.normal.y, this.normal.z);
      this.q.setFromUnitVectors(this.up, this.n);
      this.q2.setFromAxisAngle(this.up, f.yaw + Math.sin(time * 0.6 + f.phase) * 0.15);
      f.obj.quaternion.copy(this.q).multiply(this.q2);
    }
  }
}
