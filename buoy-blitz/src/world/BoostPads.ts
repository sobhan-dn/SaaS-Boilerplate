import * as THREE from 'three';
import { ARENA } from '../config';
import { waterHeightAt } from '../water/WaveModel';
import type { Boat } from '../entities/Boat';
import type { FxContext } from '../fx/FxContext';

interface Pad {
  x: number;
  z: number;
  big: boolean;
  timer: number;
  mesh: THREE.Group;
  ring: THREE.Mesh;
  core: THREE.Mesh;
  light: THREE.Mesh;
}

const W2 = ARENA.width / 2;
const L2 = ARENA.length / 2;

/** Floating rings that refill boost (small = 12, big = 100), respawning after pickup. */
export class BoostPads {
  readonly group = new THREE.Group();
  readonly pads: Pad[] = [];
  private bigMat: THREE.MeshStandardMaterial;
  private smallMat: THREE.MeshStandardMaterial;
  private coreMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.bigMat = new THREE.MeshStandardMaterial({ color: 0xffb02a, emissive: 0xffa020, emissiveIntensity: 1.6, roughness: 0.4 });
    this.smallMat = new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffc850, emissiveIntensity: 1.2, roughness: 0.4 });
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0xfff5cc, emissive: 0xffe9a0, emissiveIntensity: 2.5, transparent: true, opacity: 0.9 });

    const layout: [number, number, boolean][] = [];
    // big pads: 4 corners-ish + 2 mid-sides (mirrors the classic layout)
    for (const sx of [1, -1]) {
      layout.push([sx * (W2 - 6), 0, true]);
      for (const sz of [1, -1]) layout.push([sx * (W2 - 9), sz * (L2 - 12), true]);
    }
    // small pads
    for (const sz of [1, -1]) {
      layout.push([0, sz * (L2 - 6), false]);
      layout.push([0, sz * 13, false]);
      for (const sx of [1, -1]) {
        layout.push([sx * 9, sz * (L2 - 6), false]);
        layout.push([sx * 18, sz * (L2 - 22), false]);
        layout.push([sx * 6, sz * 26, false]);
        layout.push([sx * 20, sz * 6, false]);
      }
    }
    for (const sx of [1, -1]) layout.push([sx * 11, 0, false]);

    for (const [x, z, big] of layout) this.addPad(x, z, big);
    scene.add(this.group);
  }

  private addPad(x: number, z: number, big: boolean) {
    const mesh = new THREE.Group();
    const rr = big ? 1.5 : 0.85;
    const tube = big ? 0.32 : 0.2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, tube, 14, 36), big ? this.bigMat : this.smallMat);
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    mesh.add(ring);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(big ? 0.55 : 0.3, 1), this.coreMat);
    core.position.y = big ? 1.2 : 0.7;
    mesh.add(core);
    const light = new THREE.Mesh(
      new THREE.CylinderGeometry(big ? 0.9 : 0.5, big ? 1.4 : 0.8, big ? 1.6 : 0.9, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: big ? 0xffc35a : 0xffe6a0, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    light.position.y = big ? 0.9 : 0.5;
    mesh.add(light);
    mesh.position.set(x, 0, z);
    this.group.add(mesh);
    this.pads.push({ x, z, big, timer: 0, mesh, ring, core, light });
  }

  reset() {
    for (const p of this.pads) {
      p.timer = 0;
      p.mesh.visible = true;
    }
  }

  update(dt: number, time: number, boats: Boat[], fx: FxContext) {
    for (const p of this.pads) {
      const h = waterHeightAt(p.x, p.z, time);
      p.mesh.position.y = h + 0.05;
      p.core.rotation.y += dt * 1.5;
      p.core.rotation.x += dt * 0.7;
      p.core.position.y = (p.big ? 1.2 : 0.7) + Math.sin(time * 2 + p.x) * 0.1;
      if (p.timer > 0) {
        p.timer -= dt;
        if (p.timer <= 0) p.mesh.visible = true;
        continue;
      }
      const radius = p.big ? 2.3 : 1.7;
      for (const b of boats) {
        if (b.boost >= 100) continue;
        const dx = b.position.x - p.x;
        const dz = b.position.z - p.z;
        if (dx * dx + dz * dz < radius * radius && b.position.y < 3) {
          b.boost = Math.min(100, b.boost + (p.big ? 100 : 12));
          p.timer = p.big ? 10 : 4;
          p.mesh.visible = false;
          fx.burst(p.mesh.position, new THREE.Color(1, 0.8, 0.35), p.big ? 40 : 14, p.big ? 7 : 4);
          fx.audio.boostPickup(p.big, p.mesh.position);
          break;
        }
      }
    }
  }
}
