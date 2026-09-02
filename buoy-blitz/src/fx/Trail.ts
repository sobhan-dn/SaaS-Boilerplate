import * as THREE from 'three';
import { OVERLAY_LAYER } from '../render/GameRenderer';
import { waterHeightAt } from '../water/WaveModel';

interface TrailPoint {
  x: number;
  z: number;
  y: number;
  dirX: number;
  dirZ: number;
  age: number;
}

export interface TrailOptions {
  maxPoints: number;
  life: number;
  startWidth: number;
  endWidth: number;
  /** Ribbon follows the water surface (wake) instead of using recorded heights. */
  onSurface: boolean;
  material: THREE.Material;
  minSpacing: number;
}

/**
 * A ribbon of quads laid along a path of recorded positions, fading with age.
 * Used for boat wakes (on the water surface) and the ball's speed trail (in the air).
 */
export class Trail {
  readonly mesh: THREE.Mesh;
  private points: TrailPoint[] = [];
  private pool: TrailPoint[] = [];
  private positions: Float32Array;
  private uvs: Float32Array;
  private alphas: Float32Array;
  private geometry: THREE.BufferGeometry;
  private opts: TrailOptions;
  private lastX = 0;
  private lastZ = 0;
  private lastY = 0;

  constructor(opts: TrailOptions) {
    this.opts = opts;
    const n = opts.maxPoints;
    this.positions = new Float32Array(n * 2 * 3);
    this.uvs = new Float32Array(n * 2 * 2);
    this.alphas = new Float32Array(n * 2);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    const indices = new Uint16Array((n - 1) * 6);
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      indices[i * 6] = a;
      indices[i * 6 + 1] = a + 1;
      indices[i * 6 + 2] = a + 2;
      indices[i * 6 + 3] = a + 1;
      indices[i * 6 + 4] = a + 3;
      indices[i * 6 + 5] = a + 2;
    }
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geometry, opts.material);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(OVERLAY_LAYER);
    this.mesh.renderOrder = 15;
  }

  /** Record a new head position. dir is the travel direction (normalized, XZ). */
  push(x: number, y: number, z: number, dirX: number, dirZ: number) {
    const dx = x - this.lastX;
    const dz = z - this.lastZ;
    const dy = y - this.lastY;
    if (this.points.length > 0 && dx * dx + dz * dz + dy * dy < this.opts.minSpacing * this.opts.minSpacing) return;
    this.lastX = x;
    this.lastZ = z;
    this.lastY = y;
    let p: TrailPoint;
    if (this.points.length >= this.opts.maxPoints) {
      p = this.points.pop()!;
    } else {
      p = this.pool.pop() ?? ({} as TrailPoint);
    }
    p.x = x;
    p.y = y;
    p.z = z;
    p.dirX = dirX;
    p.dirZ = dirZ;
    p.age = 0;
    this.points.unshift(p);
  }

  update(dt: number, time: number) {
    const pts = this.points;
    for (let i = pts.length - 1; i >= 0; i--) {
      pts[i].age += dt;
      if (pts[i].age > this.opts.life) this.pool.push(pts.splice(i, 1)[0]);
    }
    const n = pts.length;
    if (n < 2) {
      this.geometry.setDrawRange(0, 0);
      return;
    }
    const { startWidth, endWidth, life, onSurface } = this.opts;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const t = p.age / life;
      const w = (startWidth + (endWidth - startWidth) * Math.sqrt(t)) * 0.5;
      const y = onSurface ? waterHeightAt(p.x, p.z, time) + 0.06 : p.y;
      const nx = -p.dirZ;
      const nz = p.dirX;
      const k = i * 6;
      this.positions[k] = p.x + nx * w;
      this.positions[k + 1] = y;
      this.positions[k + 2] = p.z + nz * w;
      this.positions[k + 3] = p.x - nx * w;
      this.positions[k + 4] = y;
      this.positions[k + 5] = p.z - nz * w;
      const ku = i * 4;
      this.uvs[ku] = 0;
      this.uvs[ku + 1] = p.age * 0.6;
      this.uvs[ku + 2] = 1;
      this.uvs[ku + 3] = p.age * 0.6;
      const a = (1 - t) * (1 - t);
      this.alphas[i * 2] = a;
      this.alphas[i * 2 + 1] = a;
    }
    this.geometry.setDrawRange(0, (n - 1) * 6);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.uv as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.pool.push(...this.points);
    this.points.length = 0;
    this.geometry.setDrawRange(0, 0);
  }
}

/** Material that multiplies texture alpha by the per-vertex age alpha. */
export function makeTrailMaterial(map: THREE.Texture, color: THREE.Color, additive: boolean, opacity = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vAlpha;
      varying vec2 vUv;
      void main() {
        vAlpha = aAlpha;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        gl_FragColor = vec4(uColor * t.rgb, t.a * vAlpha * uOpacity);
      }
    `,
    uniforms: { uMap: { value: map }, uColor: { value: color }, uOpacity: { value: opacity } },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}
