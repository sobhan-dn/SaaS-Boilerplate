import * as THREE from 'three';
import type { RippleSim } from '../water/RippleSim';
import type { ParticleSystem } from './Particles';
import type { AudioEngine } from '../audio/AudioEngine';

const SPRAY = new THREE.Color(0.85, 0.94, 1.0);

/** Shared effect services handed to entities so they can splash, glow and make noise. */
export class FxContext {
  constructor(
    readonly ripple: RippleSim,
    readonly spray: ParticleSystem,
    readonly glow: ParticleSystem,
    readonly audio: AudioEngine,
  ) {}

  /** Water impact: droplets + ring ripple. strength ~ 0..1.5 */
  splash(position: THREE.Vector3, strength: number, radius = 1.2) {
    const s = Math.min(1.6, Math.max(0.15, strength));
    this.spray.emit({
      count: Math.floor(18 + 70 * s),
      position,
      velocity: new THREE.Vector3(0, 4 + 7 * s, 0),
      spread: 1.1,
      speed: 2.5 + 4 * s,
      life: 0.7 + 0.5 * s,
      size: 0.25 + 0.3 * s,
      endSize: 0.08,
      color: SPRAY,
      colorJitter: 0.08,
      gravity: 9.81,
      drag: 0.6,
      radius: radius * 0.6,
    });
    this.ripple.addEmitter(position.x, position.z, radius, -0.9 * s);
    this.audio.splash(s, position);
  }

  /** Continuous spray behind a moving hull. */
  hullSpray(position: THREE.Vector3, velocity: THREE.Vector3, speed: number) {
    const s = Math.min(1, speed / 25);
    this.spray.emit({
      count: Math.floor(1 + 4 * s),
      position,
      velocity: new THREE.Vector3(velocity.x * 0.25, 1.5 + 2 * s, velocity.z * 0.25),
      spread: 0.8,
      speed: 1.5 + 2 * s,
      life: 0.45,
      size: 0.16 + 0.16 * s,
      endSize: 0.04,
      color: SPRAY,
      gravity: 9.81,
      drag: 0.8,
      radius: 0.5,
    });
  }

  boostTrail(position: THREE.Vector3, backward: THREE.Vector3, color: THREE.Color, inWater: boolean) {
    this.glow.emit({
      count: 3,
      position,
      velocity: backward.clone().multiplyScalar(6),
      spread: 0.35,
      speed: 2,
      life: 0.35,
      size: 0.55,
      endSize: 0.1,
      color,
      colorJitter: 0.1,
      gravity: inWater ? -1.5 : 0,
      drag: 2.5,
      radius: 0.15,
    });
    if (inWater) {
      this.spray.emit({
        count: 4,
        position,
        velocity: backward.clone().multiplyScalar(4).setY(3.5),
        spread: 0.9,
        speed: 2.5,
        life: 0.5,
        size: 0.3,
        endSize: 0.08,
        color: SPRAY,
        gravity: 9.81,
        drag: 0.6,
        radius: 0.4,
      });
    }
  }

  burst(position: THREE.Vector3, color: THREE.Color, count = 40, speed = 6) {
    this.glow.emit({ count, position, spread: 1, speed, life: 0.7, size: 0.5, endSize: 0.1, color, colorJitter: 0.15, gravity: 2, drag: 1.5, radius: 0.3 });
  }

  confetti(position: THREE.Vector3, colors: THREE.Color[], count = 220) {
    for (const c of colors) {
      this.spray.emit({ count: Math.floor(count / colors.length), position, velocity: new THREE.Vector3(0, 14, 0), spread: 1.2, speed: 9, life: 3.2, size: 0.35, endSize: 0.3, color: c, colorJitter: 0.1, gravity: 4.5, drag: 0.9, radius: 1 });
    }
    this.glow.emit({ count: 80, position, spread: 1, speed: 12, life: 1.2, size: 0.9, endSize: 0.2, color: new THREE.Color(1, 0.95, 0.7), gravity: 0, drag: 1.2, radius: 0.5 });
  }
}
