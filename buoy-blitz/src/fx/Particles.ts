import * as THREE from 'three';
import { OVERLAY_LAYER } from '../render/GameRenderer';
import { makeParticleSprite } from '../render/ProceduralTextures';

const vertexShader = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Perspective-correct world-size sprites, capped so particles brushing the lens never fill the screen.
  gl_PointSize = min(aSize * uScale / max(-mv.z, 1.0), 72.0);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor, tex.a * vAlpha);
}
`;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number; endSize: number;
  r: number; g: number; b: number;
  gravity: number; drag: number;
  alpha: number;
}

export interface EmitOptions {
  count: number;
  position: THREE.Vector3;
  velocity?: THREE.Vector3;
  spread?: number;
  speed?: number;
  life?: number;
  size?: number;
  endSize?: number;
  color?: THREE.Color;
  colorJitter?: number;
  gravity?: number;
  drag?: number;
  alpha?: number;
  radius?: number;
}

let spriteTexture: THREE.Texture | null = null;

export class ParticleSystem {
  readonly points: THREE.Points;
  private max: number;
  private particles: Particle[] = [];
  private pool: Particle[] = [];
  private positions: Float32Array;
  private sizes: Float32Array;
  private alphas: Float32Array;
  private colors: Float32Array;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor(max: number, additive: boolean) {
    this.max = max;
    spriteTexture ??= makeParticleSprite();
    this.positions = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.alphas = new Float32Array(max);
    this.colors = new Float32Array(max * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uMap: { value: spriteTexture }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.layers.set(OVERLAY_LAYER);
    this.points.renderOrder = 20;
  }

  setViewportHeight(h: number) {
    // ~ h / (2 * tan(fov/2)) for the 76-88° chase camera, so aSize is a world-space diameter.
    this.material.uniforms.uScale.value = h * 0.5;
  }

  emit(o: EmitOptions) {
    const spread = o.spread ?? 1;
    const speed = o.speed ?? 3;
    const life = o.life ?? 1;
    const size = o.size ?? 0.3;
    const color = o.color ?? new THREE.Color(1, 1, 1);
    const jitter = o.colorJitter ?? 0;
    const radius = o.radius ?? 0;
    for (let i = 0; i < o.count; i++) {
      if (this.particles.length >= this.max) return;
      const p = this.pool.pop() ?? ({} as Particle);
      const dx = (Math.random() - 0.5) * 2;
      const dy = (Math.random() - 0.5) * 2;
      const dz = (Math.random() - 0.5) * 2;
      const len = Math.hypot(dx, dy, dz) || 1;
      const s = speed * (0.5 + Math.random() * 0.8);
      p.x = o.position.x + (dx / len) * radius * Math.random();
      p.y = o.position.y + (dy / len) * radius * Math.random();
      p.z = o.position.z + (dz / len) * radius * Math.random();
      p.vx = (o.velocity?.x ?? 0) + (dx / len) * s * spread;
      p.vy = (o.velocity?.y ?? 0) + (dy / len) * s * spread;
      p.vz = (o.velocity?.z ?? 0) + (dz / len) * s * spread;
      p.maxLife = life * (0.6 + Math.random() * 0.8);
      p.life = p.maxLife;
      p.size = size * (0.7 + Math.random() * 0.6);
      p.endSize = o.endSize ?? p.size * 0.4;
      const j = (Math.random() - 0.5) * jitter;
      p.r = Math.min(1, Math.max(0, color.r + j));
      p.g = Math.min(1, Math.max(0, color.g + j));
      p.b = Math.min(1, Math.max(0, color.b + j));
      p.gravity = o.gravity ?? 9.81;
      p.drag = o.drag ?? 0.5;
      p.alpha = o.alpha ?? 1;
      this.particles.push(p);
    }
  }

  update(dt: number) {
    const ps = this.particles;
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.pool.push(p);
        continue;
      }
      p.vy -= p.gravity * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      ps[n++] = p;
      const t = 1 - p.life / p.maxLife;
      const k = (n - 1) * 3;
      this.positions[k] = p.x;
      this.positions[k + 1] = p.y;
      this.positions[k + 2] = p.z;
      this.sizes[n - 1] = p.size + (p.endSize - p.size) * t;
      this.alphas[n - 1] = p.alpha * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      this.colors[k] = p.r;
      this.colors[k + 1] = p.g;
      this.colors[k + 2] = p.b;
    }
    ps.length = n;
    this.geometry.setDrawRange(0, n);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.pool.push(...this.particles);
    this.particles.length = 0;
    this.geometry.setDrawRange(0, 0);
  }
}
