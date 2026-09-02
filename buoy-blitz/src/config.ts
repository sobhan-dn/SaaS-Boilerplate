export const GRAVITY = 9.81;
export const FIXED_DT = 1 / 60;

/** Arena dimensions in meters. Z axis runs goal-to-goal, X across. */
export const ARENA = {
  width: 56,
  length: 84,
  wallHeight: 20,
  cornerCut: 11,
  goalWidth: 15,
  goalHeight: 6,
  goalDepth: 7.5,
  floorY: -6.5,
  /** Region covered by the interactive ripple simulation (half extents). */
  rippleHalfX: 32,
  rippleHalfZ: 52,
};

export const BOAT = {
  length: 3.4,
  width: 2.1,
  height: 0.95,
  mass: 190,
  /** Draft at rest (meters of hull under water when floating). */
  restDraft: 0.34,
  /** Centre of mass height in hull-local space; below the buoyancy samples for metacentric stability. */
  comHeight: -0.6,
  thrust: 14.5, // m/s^2 at full throttle
  reverseFactor: 0.55,
  steerTorque: 6.0, // rad/s^2 scale
  keelGrip: 6.5, // lateral velocity damping /s
  maxSpeed: 25,
  maxBoostSpeed: 34.5,
  boostAccel: 16.5,
  boostDrainPerSec: 33,
  jumpSpeed: 7.2,
  dodgeSpeed: 10.5,
  dodgeUp: 2.4,
  airPitch: 7.5,
  airYaw: 4.5,
  airRoll: 8.5,
  waterLinearDrag: 0.3,
  waterQuadDrag: 0.012,
  airDrag: 0.02,
  rightingTorque: 22,
  startBoost: 33,
};

export const BALL = {
  radius: 1.4,
  mass: 32,
  restitution: 0.62,
  friction: 0.35,
  /** Fraction of the ball volume under water when floating at rest. */
  restSubmersion: 0.42,
  hitBoostFactor: 9.5,
};

export const MATCH = {
  kickoffCountdown: 3,
  goalCelebration: 4.2,
  overtimeEnabled: true,
};

export type Team = 0 | 1; // 0 = blue (defends -Z), 1 = orange (defends +Z)

export const TEAM_COLORS: Record<Team, { main: number; accent: number; light: number; name: string; css: string }> = {
  0: { main: 0x2f8cff, accent: 0x7ff2ff, light: 0x9fd0ff, name: 'BLUE', css: '#2f8cff' },
  1: { main: 0xff8a2a, accent: 0xffe36b, light: 0xffc48a, name: 'ORANGE', css: '#ff8a2a' },
};

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  reflection: boolean;
  reflectionScale: number;
  rippleSize: [number, number];
  bloom: boolean;
  fxaa: boolean;
  waterSegments: number;
  particles: number;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: { pixelRatio: 0.7, shadows: false, shadowMapSize: 512, reflection: false, reflectionScale: 0.25, rippleSize: [128, 192], bloom: false, fxaa: true, waterSegments: 120, particles: 800 },
  medium: { pixelRatio: 1.0, shadows: true, shadowMapSize: 1024, reflection: true, reflectionScale: 0.35, rippleSize: [256, 384], bloom: true, fxaa: true, waterSegments: 180, particles: 1500 },
  high: { pixelRatio: Math.min(window.devicePixelRatio, 1.5), shadows: true, shadowMapSize: 2048, reflection: true, reflectionScale: 0.5, rippleSize: [384, 576], bloom: true, fxaa: true, waterSegments: 240, particles: 2500 },
  ultra: { pixelRatio: Math.min(window.devicePixelRatio, 2), shadows: true, shadowMapSize: 4096, reflection: true, reflectionScale: 0.75, rippleSize: [512, 768], bloom: true, fxaa: true, waterSegments: 300, particles: 4000 },
};
