import * as THREE from 'three';
import { waterHeightAt } from '../water/WaveModel';
import { ARENA } from '../config';

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
  private fwdTmp = new THREE.Vector3();
  private clampDir = new THREE.Vector3();
  private clampProbe = new THREE.Vector3();

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
      const back = 8.6 + Math.min(4, dist * 0.06);
      const height = 3.4 + Math.min(4, Math.max(0, ballPos.y - boatPos.y) * 0.25);
      targetPos = this.tmp2.copy(boatPos).addScaledVector(dir, -back);
      targetPos.y = boatPos.y + height;
      const followRate = 1 - Math.exp(-dt * 7);
      this.pos.lerp(targetPos, followRate);
      lookTarget = this.tmp.copy(ballPos).lerp(boatPos, 0.32);
      lookTarget.y += 0.6;
      this.smoothLook.lerp(lookTarget, 1 - Math.exp(-dt * 10));
    } else {
      const fwd = this.fwdTmp.set(boatForward.x, 0, boatForward.z);
      const hv = this.tmp2.set(boatVel.x, 0, boatVel.z);
      const hs = hv.length();
      // Follow the heading of travel once moving so aerial spins/dodges do not whip the view around.
      if (hs > 2) fwd.lerp(hv.normalize(), THREE.MathUtils.smoothstep(hs, 2, 8) * 0.9);
      if (fwd.lengthSq() < 0.001) fwd.set(0, 0, 1);
      fwd.normalize();
      targetPos = this.tmp2.copy(boatPos).addScaledVector(fwd, -9.0);
      targetPos.y = boatPos.y + 4.6;
      this.pos.lerp(targetPos, 1 - Math.exp(-dt * 5));
      lookTarget = this.tmp.copy(boatPos).addScaledVector(fwd, 5.5);
      lookTarget.y += 0.6;
      this.smoothLook.lerp(lookTarget, 1 - Math.exp(-dt * 8));
    }

    if (this.mode !== 'cinematic') this.clampToArena(this.pos, this.smoothLook);

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
    const targetFov = this.mode === 'cinematic' ? 55 : 68 + Math.min(9, speed * 0.22);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Keep the camera inside the arena shell (walls, ceiling and the 45° corner cuts).
   * When the wall pushes the camera in, slide it along the view ray toward the look target
   * instead of a hard axis clamp so it never pops through geometry.
   */
  private clampToArena(pos: THREE.Vector3, look: THREE.Vector3) {
    const margin = CAMERA_WALL_MARGIN;
    const hw = ARENA.width / 2 - margin;
    const hl = ARENA.length / 2 - margin;
    const diag = ARENA.width / 2 + ARENA.length / 2 - ARENA.cornerCut - margin * 1.4;
    const ceiling = ARENA.wallHeight - margin;

    const inside = (p: THREE.Vector3) =>
      Math.abs(p.x) <= hw && Math.abs(p.z) <= hl && Math.abs(p.x) + Math.abs(p.z) <= diag && p.y <= ceiling;

    if (inside(pos)) return;

    // Binary search along the ray from the look target to the desired position for the last inside point.
    const dir = this.clampDir.subVectors(pos, look);
    const len = dir.length();
    if (len < 1e-3 || !inside(look)) {
      pos.x = THREE.MathUtils.clamp(pos.x, -hw, hw);
      pos.z = THREE.MathUtils.clamp(pos.z, -hl, hl);
      pos.y = Math.min(pos.y, ceiling);
      const over = Math.abs(pos.x) + Math.abs(pos.z) - diag;
      if (over > 0) {
        pos.x -= Math.sign(pos.x) * over * 0.5;
        pos.z -= Math.sign(pos.z) * over * 0.5;
      }
      return;
    }
    dir.divideScalar(len);
    let lo = 0;
    let hi = len;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) * 0.5;
      this.clampProbe.copy(look).addScaledVector(dir, mid);
      if (inside(this.clampProbe)) lo = mid;
      else hi = mid;
    }
    // Keep a minimum distance so the camera does not end up inside the boat when cornered.
    const dist = Math.max(lo, MIN_CAMERA_DISTANCE);
    pos.copy(look).addScaledVector(dir, dist);
    // Trade the lost distance for height so the framing stays readable when backed against a wall.
    pos.y += (len - dist) * 0.45;
    pos.y = Math.min(pos.y, ceiling);
  }
}

const CAMERA_WALL_MARGIN = 1.6;
const MIN_CAMERA_DISTANCE = 4.5;
