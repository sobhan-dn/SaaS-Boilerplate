import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import type { QualitySettings } from '../config';
import { WaterSurface, WATER_LAYER } from '../water/WaterSurface';
import { copyDepthFragmentShader, fullscreenVertexShader } from '../water/waterShaders';

/** Objects on this layer (spray, wakes, flames, markers) are drawn after the water so they sit on / above it correctly. */
export const OVERLAY_LAYER = 4;

/**
 * Render pipeline:
 *  1. ripple simulation step
 *  2. planar reflection pass (mirrored camera, water hidden)
 *  3. opaque scene -> sceneRT (color + depth)
 *  4. composite: copy sceneRT color+depth, draw water reading scene color/depth (refraction, depth fade),
 *     then draw surface FX overlays depth-tested against scene + water
 *  5. post: bloom -> tonemap/sRGB -> FXAA
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly sceneRT: THREE.WebGLRenderTarget;
  private copyScene = new THREE.Scene();
  private copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private copyMaterial: THREE.ShaderMaterial;
  private quality: QualitySettings;
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0x87b8d6, 1);

    const depthTexture = new THREE.DepthTexture(1, 1);
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.format = THREE.DepthFormat;
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthTexture,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.sceneRT.texture.name = 'sceneColor';

    const compositeRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false });
    this.composer = new EffectComposer(this.renderer, compositeRT);

    if (quality.bloom) {
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.5, 1.45));
    }
    this.composer.addPass(new OutputPass());
    if (quality.fxaa) this.composer.addPass(new FXAAPass());

    this.copyMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVertexShader,
      fragmentShader: copyDepthFragmentShader,
      uniforms: { tDiffuse: { value: null }, tDepth: { value: null } },
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMaterial);
    quad.frustumCulled = false;
    this.copyScene.add(quad);
  }

  setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
    const pr = this.quality.pixelRatio;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.sceneRT.setSize(Math.max(1, Math.floor(width * pr)), Math.max(1, Math.floor(height * pr)));
  }

  get bufferWidth() {
    return Math.floor(this.width * this.quality.pixelRatio);
  }

  get bufferHeight() {
    return Math.floor(this.height * this.quality.pixelRatio);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, water: WaterSurface, dt: number) {
    const r = this.renderer;
    r.shadowMap.needsUpdate = true;

    water.ripple.step(r, 1);

    if (water.reflectionTarget && water.updateReflectionCamera(camera)) {
      water.reflectionCamera.layers.set(0);
      r.setRenderTarget(water.reflectionTarget);
      r.clear();
      r.render(scene, water.reflectionCamera);
      r.shadowMap.needsUpdate = false;
    }

    camera.layers.set(0);
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);
    r.shadowMap.needsUpdate = false;

    const target = this.composer.readBuffer;
    r.setRenderTarget(target);
    r.clear();
    this.copyMaterial.uniforms.tDiffuse.value = this.sceneRT.texture;
    this.copyMaterial.uniforms.tDepth.value = this.sceneRT.depthTexture;
    r.render(this.copyScene, this.copyCamera);

    water.setSceneBuffers(this.sceneRT.texture, this.sceneRT.depthTexture!, this.sceneRT.width, this.sceneRT.height);
    const fogBackup = scene.fog;
    scene.fog = null;
    r.autoClear = false;
    camera.layers.set(WATER_LAYER);
    r.render(scene, camera);
    scene.fog = fogBackup;
    camera.layers.set(OVERLAY_LAYER);
    r.render(scene, camera);
    r.autoClear = true;
    camera.layers.set(0);

    this.composer.render(dt);
  }

  dispose() {
    this.sceneRT.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
