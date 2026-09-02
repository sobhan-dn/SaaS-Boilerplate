import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { WaterEnvironment } from '../water/WaterSurface';
import type { QualitySettings } from '../config';

export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: Sky;
  readonly sunDir = new THREE.Vector3();
  readonly waterEnv: WaterEnvironment;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: QualitySettings) {
    const elevation = 24;
    const azimuth = 205;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);

    this.sky = new Sky();
    this.sky.scale.setScalar(2400);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 3.2;
    su.rayleigh.value = 1.6;
    su.mieCoefficient.value = 0.0045;
    su.mieDirectionalG.value = 0.86;
    su.sunPosition.value.copy(this.sunDir);
    if (su.cloudCoverage) {
      su.cloudCoverage.value = 0.38;
      su.cloudDensity.value = 0.45;
      su.cloudScale.value = 0.00025;
      su.cloudSpeed.value = 0.02;
    }
    // The sky is rendered into HDR half-float targets; clamp the sun disc so it cannot overflow to inf/NaN.
    this.sky.material.fragmentShader = this.sky.material.fragmentShader.replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      'gl_FragColor = vec4( min( texColor, vec3( 3.0 ) ), 1.0 );',
    );
    this.sky.material.needsUpdate = true;

    // The environment map comes from a clamped analytic dome: the atmospheric Sky shader can overflow
    // half-float range around the sun disk, which turns the whole PMREM into NaN on some GPUs.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color(0.16, 0.38, 0.82) },
        uHorizon: { value: new THREE.Color(0.72, 0.82, 0.92) },
        uGround: { value: new THREE.Color(0.08, 0.22, 0.3) },
        uSunDir: { value: this.sunDir.clone() },
        uSunColor: { value: new THREE.Color(1.0, 0.92, 0.78) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor;
        void main() {
          vec3 d = normalize(vDir);
          float t = clamp(d.y, -1.0, 1.0);
          vec3 col = t >= 0.0 ? mix(uHorizon, uZenith, pow(t, 0.55)) : mix(uHorizon, uGround, pow(-t, 0.4));
          float cosSun = max(dot(d, uSunDir), 0.0);
          col += uSunColor * (pow(cosSun, 400.0) * 8.0 + pow(cosSun, 10.0) * 0.35);
          gl_FragColor = vec4(min(col, vec3(16.0)), 1.0);
        }
      `,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), domeMat);
    envScene.add(dome);
    const envRT = pmrem.fromScene(envScene, 0, 1, 2000);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.7;
    pmrem.dispose();
    dome.geometry.dispose();
    domeMat.dispose();
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
    this.sun.position.copy(this.sunDir).multiplyScalar(160);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = quality.shadows;
    const sc = this.sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 40;
    sc.far = 320;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9fd0ff, 0x1f5a78, 0.55);
    scene.add(this.hemi);

    const fogColor = new THREE.Color(0xa9c8de);
    scene.fog = new THREE.FogExp2(fogColor, 0.0011);

    this.waterEnv = {
      sunDir: this.sunDir.clone(),
      sunColor: new THREE.Color(1.0, 0.93, 0.8).multiplyScalar(1.15),
      ambient: new THREE.Color(0.33, 0.48, 0.62),
      skyZenith: new THREE.Color(0.16, 0.38, 0.82),
      skyHorizon: new THREE.Color(0.72, 0.82, 0.92),
      fogColor: fogColor.clone(),
      fogDensity: 0.0011,
    };
  }

  update(time: number) {
    const t = this.sky.material.uniforms.time;
    if (t) t.value = time;
  }
}
