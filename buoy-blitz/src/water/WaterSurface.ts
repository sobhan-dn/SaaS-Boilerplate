import * as THREE from 'three';
import { ARENA } from '../config';
import { waveUniformArrays, WAVE_COUNT } from './WaveModel';
import { waterFragmentShader, waterVertexShader } from './waterShaders';
import { RippleSim } from './RippleSim';
import { makeFoamTexture, makeWaterNormalMap } from '../render/ProceduralTextures';

export const WATER_LAYER = 3;

/**
 * Builds a single grid that is very dense around the arena and stretches to the horizon.
 * t in [-1,1] maps to x(t) = t * dense + t^7 * (extent - dense).
 */
function buildWaterGeometry(segments: number, denseHalf: number, extentHalf: number): THREE.BufferGeometry {
  const n = segments;
  const verts = new Float32Array((n + 1) * (n + 1) * 3);
  const map = (t: number) => t * denseHalf + Math.pow(t, 7) * (extentHalf - denseHalf);
  let p = 0;
  for (let j = 0; j <= n; j++) {
    const tz = (j / n) * 2 - 1;
    const z = map(tz) * (ARENA.rippleHalfZ / ARENA.rippleHalfX);
    for (let i = 0; i <= n; i++) {
      const tx = (i / n) * 2 - 1;
      verts[p++] = map(tx);
      verts[p++] = 0;
      verts[p++] = z;
    }
  }
  const indices = new Uint32Array(n * n * 6);
  let q = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      indices[q++] = a;
      indices[q++] = c;
      indices[q++] = b;
      indices[q++] = b;
      indices[q++] = c;
      indices[q++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  return geo;
}

export interface WaterEnvironment {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  ambient: THREE.Color;
  skyZenith: THREE.Color;
  skyHorizon: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
}

export class WaterSurface {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly ripple: RippleSim;
  readonly reflectionCamera = new THREE.PerspectiveCamera();
  readonly reflectionTarget: THREE.WebGLRenderTarget | null;
  private reflectionMatrix = new THREE.Matrix4();
  private reflectionEnabled: boolean;

  constructor(segments: number, rippleSize: [number, number], reflection: boolean, reflectionSize: [number, number]) {
    this.ripple = new RippleSim(rippleSize[0], rippleSize[1]);
    this.reflectionEnabled = reflection;
    this.reflectionTarget = reflection
      ? new THREE.WebGLRenderTarget(reflectionSize[0], reflectionSize[1], { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 })
      : null;

    const { dirs, params } = waveUniformArrays();
    const waveDir: THREE.Vector2[] = [];
    const waveParams: THREE.Vector4[] = [];
    for (let i = 0; i < WAVE_COUNT; i++) {
      waveDir.push(new THREE.Vector2(dirs[i * 2], dirs[i * 2 + 1]));
      waveParams.push(new THREE.Vector4(params[i * 4], params[i * 4 + 1], params[i * 4 + 2], params[i * 4 + 3]));
    }
    const texelWorld = this.ripple.texelWorld;

    this.material = new THREE.ShaderMaterial({
      vertexShader: waterVertexShader,
      fragmentShader: waterFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWaveDir: { value: waveDir },
        uWaveParams: { value: waveParams },
        uArenaHalf: { value: new THREE.Vector2(ARENA.width * 0.5, ARENA.length * 0.5 + ARENA.goalDepth) },
        uRipple: { value: this.ripple.texture },
        uRippleHalf: { value: new THREE.Vector2(ARENA.rippleHalfX, ARENA.rippleHalfZ) },
        uRippleTexel: { value: new THREE.Vector2(1 / this.ripple.width, 1 / this.ripple.height) },
        uRippleTexelWorld: { value: texelWorld },
        uRippleScale: { value: 0.22 },
        uCameraPos: { value: new THREE.Vector3() },
        uCameraForward: { value: new THREE.Vector3(0, 0, -1) },
        uCameraNear: { value: 0.3 },
        uCameraFar: { value: 3000 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uSceneColor: { value: null },
        uSceneDepth: { value: null },
        uReflection: { value: this.reflectionTarget ? this.reflectionTarget.texture : null },
        uReflectionMatrix: { value: this.reflectionMatrix },
        uReflectionEnabled: { value: reflection ? 1 : 0 },
        uNormalMap: { value: makeWaterNormalMap(256, 2.4) },
        uFoamMap: { value: makeFoamTexture(256) },
        uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.4).normalize() },
        uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
        uAmbient: { value: new THREE.Color(0.35, 0.45, 0.6) },
        uSkyZenith: { value: new THREE.Color(0.2, 0.45, 0.9) },
        uSkyHorizon: { value: new THREE.Color(0.75, 0.85, 0.95) },
        uScatterColor: { value: new THREE.Color(0.05, 0.35, 0.42) },
        uAbsorption: { value: new THREE.Vector3(0.42, 0.16, 0.09) },
        uFogColor: { value: new THREE.Color(0.7, 0.8, 0.9) },
        uFogDensity: { value: 0.0012 },
        uDetailStrength: { value: 0.32 },
        uRefractStrength: { value: 0.09 },
        uReflectDistort: { value: 0.045 },
      },
      side: THREE.FrontSide,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    });

    const geometry = buildWaterGeometry(segments, ARENA.rippleHalfX, 1400);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(WATER_LAYER);
    this.mesh.renderOrder = 10;
    this.mesh.matrixAutoUpdate = false;
  }

  setEnvironment(env: WaterEnvironment) {
    const u = this.material.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(env.sunDir);
    (u.uSunColor.value as THREE.Color).copy(env.sunColor);
    (u.uAmbient.value as THREE.Color).copy(env.ambient);
    (u.uSkyZenith.value as THREE.Color).copy(env.skyZenith);
    (u.uSkyHorizon.value as THREE.Color).copy(env.skyHorizon);
    (u.uFogColor.value as THREE.Color).copy(env.fogColor);
    u.uFogDensity.value = env.fogDensity;
  }

  setSceneBuffers(color: THREE.Texture, depth: THREE.Texture, width: number, height: number) {
    const u = this.material.uniforms;
    u.uSceneColor.value = color;
    u.uSceneDepth.value = depth;
    (u.uResolution.value as THREE.Vector2).set(width, height);
  }

  setReflectionSize(w: number, h: number) {
    this.reflectionTarget?.setSize(Math.max(8, Math.floor(w)), Math.max(8, Math.floor(h)));
  }

  update(time: number, camera: THREE.PerspectiveCamera) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uRipple.value = this.ripple.texture;
    (u.uCameraPos.value as THREE.Vector3).copy(camera.position);
    camera.getWorldDirection(u.uCameraForward.value as THREE.Vector3);
    u.uCameraNear.value = camera.near;
    u.uCameraFar.value = camera.far;
  }

  /**
   * Mirrors the main camera about the water plane (y = planeY) and builds an oblique projection
   * that clips everything below the surface. Returns false when the camera is under water.
   */
  updateReflectionCamera(camera: THREE.PerspectiveCamera, planeY = -0.35): boolean {
    if (!this.reflectionEnabled) return false;
    const normal = new THREE.Vector3(0, 1, 0);
    const planePoint = new THREE.Vector3(0, planeY, 0);
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const view = new THREE.Vector3().subVectors(planePoint, camPos);
    if (view.dot(normal) > 0) return false;
    view.reflect(normal).negate().add(planePoint);

    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const lookAt = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const target = new THREE.Vector3().subVectors(planePoint, lookAt);
    target.reflect(normal).negate().add(planePoint);

    const vc = this.reflectionCamera;
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    vc.lookAt(target);
    vc.near = camera.near;
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    this.reflectionMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.reflectionMatrix.multiply(vc.projectionMatrix);
    this.reflectionMatrix.multiply(vc.matrixWorldInverse);

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, planePoint);
    plane.applyMatrix4(vc.matrixWorldInverse);
    const clipPlane = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vc.projectionMatrix;
    const q = new THREE.Vector4();
    q.x = (Math.sign(clipPlane.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(clipPlane.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0;
    q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
    pm.elements[2] = clipPlane.x;
    pm.elements[6] = clipPlane.y;
    pm.elements[10] = clipPlane.z + 1.0 - 0.003;
    pm.elements[14] = clipPlane.w;
    return true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.ripple.dispose();
    this.reflectionTarget?.dispose();
  }
}
