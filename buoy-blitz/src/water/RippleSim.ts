import * as THREE from 'three';
import { ARENA } from '../config';
import { fullscreenVertexShader, rippleSimShader } from './waterShaders';

const MAX_EMITTERS = 12;

/**
 * GPU 2D wave-equation solver producing interactive surface ripples (boat wakes, ball splashes).
 * Heights live in the red channel, previous heights in green. Ping-pong between two targets.
 */
export class RippleSim {
  readonly width: number;
  readonly height: number;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private emitters = new Float32Array(MAX_EMITTERS * 4);
  private emitterCount = 0;
  private emitterUniform: THREE.Vector4[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const opts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.rtA = new THREE.WebGLRenderTarget(width, height, opts);
    this.rtB = new THREE.WebGLRenderTarget(width, height, opts);
    for (let i = 0; i < MAX_EMITTERS; i++) this.emitterUniform.push(new THREE.Vector4());
    this.material = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertexShader,
      fragmentShader: rippleSimShader,
      uniforms: {
        uPrev: { value: null },
        uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
        uDamping: { value: 0.986 },
        uEmitters: { value: this.emitterUniform },
        uEmitterCount: { value: 0 },
        uAspect: { value: (ARENA.rippleHalfX * 2) / (ARENA.rippleHalfZ * 2) },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  get texture(): THREE.Texture {
    return this.rtA.texture;
  }

  get texelWorld(): THREE.Vector2 {
    return new THREE.Vector2((ARENA.rippleHalfX * 2) / this.width, (ARENA.rippleHalfZ * 2) / this.height);
  }

  /** Queue a disturbance at world position (x, z). radius in meters; strength in height units per step (negative pushes down). */
  addEmitter(x: number, z: number, radius: number, strength: number) {
    if (this.emitterCount >= MAX_EMITTERS) return;
    const u = x / (ARENA.rippleHalfX * 2) + 0.5;
    const v = z / (ARENA.rippleHalfZ * 2) + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    const i = this.emitterCount++ * 4;
    this.emitters[i] = u;
    this.emitters[i + 1] = v;
    this.emitters[i + 2] = radius / (ARENA.rippleHalfZ * 2);
    this.emitters[i + 3] = strength;
  }

  step(renderer: THREE.WebGLRenderer, iterations = 1) {
    const prevTarget = renderer.getRenderTarget();
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < MAX_EMITTERS; i++) {
        const v = this.emitterUniform[i];
        if (i < this.emitterCount) {
          v.set(this.emitters[i * 4], this.emitters[i * 4 + 1], this.emitters[i * 4 + 2], this.emitters[i * 4 + 3] / iterations);
        } else {
          v.set(0, 0, 1, 0);
        }
      }
      this.material.uniforms.uEmitterCount.value = this.emitterCount;
      this.material.uniforms.uPrev.value = this.rtA.texture;
      renderer.setRenderTarget(this.rtB);
      renderer.render(this.scene, this.camera);
      const t = this.rtA;
      this.rtA = this.rtB;
      this.rtB = t;
    }
    renderer.setRenderTarget(prevTarget);
    this.emitterCount = 0;
  }

  clear(renderer: THREE.WebGLRenderer) {
    const prev = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.rtA);
    renderer.clear(true, false, false);
    renderer.setRenderTarget(this.rtB);
    renderer.clear(true, false, false);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.setRenderTarget(prev);
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.material.dispose();
  }
}
