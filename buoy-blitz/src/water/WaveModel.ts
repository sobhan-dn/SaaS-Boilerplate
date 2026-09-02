import { GRAVITY, ARENA } from '../config';

/**
 * Gerstner wave spectrum shared by the CPU (buoyancy sampling) and the GPU (water surface).
 * Waves are deep-water waves: omega = sqrt(g * k).
 */
export interface GerstnerWave {
  dirX: number;
  dirZ: number;
  amplitude: number;
  wavelength: number;
  steepness: number;
}

function makeWave(angleDeg: number, amplitude: number, wavelength: number, steepness: number): GerstnerWave {
  const a = (angleDeg * Math.PI) / 180;
  return { dirX: Math.cos(a), dirZ: Math.sin(a), amplitude, wavelength, steepness };
}

export const WAVES: GerstnerWave[] = [
  makeWave(22, 0.17, 26, 0.55),
  makeWave(-48, 0.11, 15, 0.6),
  makeWave(105, 0.075, 8.5, 0.65),
  makeWave(160, 0.045, 4.6, 0.7),
  makeWave(70, 0.028, 2.6, 0.75),
];

export const WAVE_COUNT = WAVES.length;

interface WaveDerived { k: number; omega: number; q: number }
const derived: WaveDerived[] = WAVES.map((w) => {
  const k = (2 * Math.PI) / w.wavelength;
  return { k, omega: Math.sqrt(GRAVITY * k), q: w.steepness / (k * w.amplitude * WAVE_COUNT) };
});

/** Waves grow outside the arena so the surrounding sea looks alive; inside the walls the water stays playable. */
export function oceanAmplitudeScale(x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x) - ARENA.width * 0.5);
  const dz = Math.max(0, Math.abs(z) - ARENA.length * 0.5 - ARENA.goalDepth);
  const d = Math.sqrt(dx * dx + dz * dz);
  const s = Math.min(1, Math.max(0, d / 45));
  return 1 + 2.6 * s * s * (3 - 2 * s);
}

/**
 * Surface displacement of the rest-position point (x0, z0) at time t. Returns [dx, dy, dz].
 */
export function gerstnerDisplace(x0: number, z0: number, t: number, out: number[]): number[] {
  let dx = 0;
  let dy = 0;
  let dz = 0;
  const scale = oceanAmplitudeScale(x0, z0);
  for (let i = 0; i < WAVE_COUNT; i++) {
    const w = WAVES[i];
    const d = derived[i];
    const amp = w.amplitude * scale;
    const f = d.k * (w.dirX * x0 + w.dirZ * z0) - d.omega * t;
    const c = Math.cos(f);
    const s = Math.sin(f);
    dx += d.q * amp * w.dirX * c;
    dz += d.q * amp * w.dirZ * c;
    dy += amp * s;
  }
  out[0] = dx;
  out[1] = dy;
  out[2] = dz;
  return out;
}

const tmp = [0, 0, 0];

/**
 * Height of the water surface at world position (x, z). Gerstner waves displace horizontally,
 * so we invert the mapping with a couple of fixed-point iterations.
 */
export function waterHeightAt(x: number, z: number, t: number): number {
  let px = x;
  let pz = z;
  for (let i = 0; i < 3; i++) {
    gerstnerDisplace(px, pz, t, tmp);
    px = x - tmp[0];
    pz = z - tmp[2];
  }
  gerstnerDisplace(px, pz, t, tmp);
  return tmp[1];
}

/** Approximate surface normal via finite differences (cheap, sufficient for gameplay). */
export function waterNormalAt(x: number, z: number, t: number, out: { x: number; y: number; z: number }) {
  const e = 0.35;
  const hL = waterHeightAt(x - e, z, t);
  const hR = waterHeightAt(x + e, z, t);
  const hD = waterHeightAt(x, z - e, t);
  const hU = waterHeightAt(x, z + e, t);
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * e;
  const len = Math.hypot(nx, ny, nz);
  out.x = nx / len;
  out.y = ny / len;
  out.z = nz / len;
  return out;
}

/** Uniform arrays for the GPU: dir.xy per wave, and (amplitude, k, omega, q) per wave. */
export function waveUniformArrays() {
  const dirs = new Float32Array(WAVE_COUNT * 2);
  const params = new Float32Array(WAVE_COUNT * 4);
  for (let i = 0; i < WAVE_COUNT; i++) {
    dirs[i * 2] = WAVES[i].dirX;
    dirs[i * 2 + 1] = WAVES[i].dirZ;
    params[i * 4] = WAVES[i].amplitude;
    params[i * 4 + 1] = derived[i].k;
    params[i * 4 + 2] = derived[i].omega;
    params[i * 4 + 3] = derived[i].q;
  }
  return { dirs, params };
}
