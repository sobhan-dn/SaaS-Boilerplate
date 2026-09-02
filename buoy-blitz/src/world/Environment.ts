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

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(this.sky);
    const envRT = pmrem.fromScene(envScene, 0, 0.1, 3000);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.75;
    pmrem.dispose();
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
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

    this.hemi = new THREE.HemisphereLight(0x9fd0ff, 0x1f5a78, 0.85);
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
}
