import * as THREE from 'three';
import { waterHeightAt } from '../water/WaveModel';

export type CameraMode = 'ball' | 'boat' | 'cinematic';

/** Rocket-League-style chase camera with ball cam, boat cam and a cinematic orbit for goals. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'ball';
  private pos = new THREE.Vector3(0, 8, -30);
  private look = new THREE.Vector3();
  private shake = 0;
  private shakeVec = new THREE.Vector3();
  private orbitAngle = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private smoothLook = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(78, aspect, 0.3, 3000);
    this.camera.position.copy(this.pos);
  }

  toggle() {
    if (this.mode === 'cinematic') return;
    this.mode = this.mode === 'ball' ? 'boat' : 'ball';
  }

  addShake(amount: number) {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  snapTo(boatPos: THREE.Vector3, boatForward: THREE.Vector3, ballPos: THREE.Vector3) {
    const dir = this.tmp.subVectors(ballPos, boatPos).setY(0);
    if (dir.lengthSq() < 0.01) dir.copy(boatForward).setY(0);
    dir.normalize();
    this.pos.copy(boatPos).addScaledVector(dir, -11).add(new THREE.Vector3(0, 4.2, 0));
    this.smoothLook.copy(ballPos);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(ballPos);
  }

  update(dt: number, time: number, boatPos: THREE.Vector3, boatForward: THREE.Vector3, boatVel: THREE.Vector3, ballPos: THREE.Vector3) {
    let targetPos: THREE.Vector3;
    let lookTarget: THREE.Vector3;
    if (this.mode === 'cinematic') {
      this.orbitAngle += dt * 0.35;
      const r = 16;
      targetPos = this.tmp.set(ballPos.x + Math.cos(this.orbitAngle) * r, ballPos.y + 6, ballPos.z + Math.sin(this.orbitAngle) * r);
      lookTarget = this.tmp2.copy(ballPos);
      this.pos.lerp(targetPos, 1 - Math.exp(-dt * 2.5));
      this.smoothLook.lerp(lookTarget, 1 - Math.exp(-dt * 6));
    } else if (this.mode === 'ball') {
      const dir = this.tmp.subVectors(ballPos, boatPos).setY(0);
      const dist = dir.length();
      if (dist < 0.5) dir.copy(boatForward).setY(0);
      dir.normalize();
      const back = 10.5 + Math.min(6, dist * 0.08);
      const height = 4.0 + Math.min(4, Math.max(0, ballPos.y - boatPos.y) * 0.25);
      targetPos = this.tmp2.copy(boatPos).addScaledVector(dir, -back);
      targetPos.y = boatPos.y + height;
      const followRate = 1 - Math.exp(-dt * 7);
      this.pos.lerp(targetPos, followRate);
      lookTarget = this.tmp.copy(ballPos).lerp(boatPos, 0.28);
      lookTarget.y += 0.8;
      this.smoothLook.lerp(lookTarget, 1 - Math.exp(-dt * 10));
    } else {
      const fwd = this.tmp.set(boatForward.x, 0, boatForward.z);
      const hv = this.tmp2.set(boatVel.x, 0, boatVel.z);
      if (hv.length() > 4) fwd.lerp(hv.normalize(), 0.5);
      if (fwd.lengthSq() < 0.001) fwd.set(0, 0, 1);
      fwd.normalize();
      targetPos = this.tmp2.copy(boatPos).addScaledVector(fwd, -10.5);
      targetPos.y = boatPos.y + 4.0;
      this.pos.lerp(targetPos, 1 - Math.exp(-dt * 5));
      lookTarget = this.tmp.copy(boatPos).addScaledVector(fwd, 8);
      lookTarget.y += 1.2;
      this.smoothLook.lerp(lookTarget, 1 - Math.exp(-dt * 8));
    }

    // never dip under the water
    const h = waterHeightAt(this.pos.x, this.pos.z, time);
    if (this.pos.y < h + 1.1) this.pos.y = h + 1.1;

    this.shake = Math.max(0, this.shake - dt * 2.2);
    const s = this.shake * this.shake * 0.35;
    this.shakeVec.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);

    this.camera.position.copy(this.pos).add(this.shakeVec);
    this.look.copy(this.smoothLook);
    this.camera.lookAt(this.look);
    const speed = boatVel.length();
    const targetFov = this.mode === 'cinematic' ? 55 : 76 + Math.min(12, speed * 0.3);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();
  }
}
