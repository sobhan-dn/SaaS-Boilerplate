import * as THREE from 'three';
import { TEAM_COLORS, type Team } from '../config';
import { makeTubeTexture } from '../render/ProceduralTextures';
import { OVERLAY_LAYER } from '../render/GameRenderer';

export interface BoatVisual {
  root: THREE.Group;
  /** Group that gets squished on impacts. */
  body: THREE.Group;
  propeller: THREE.Object3D;
  motor: THREE.Object3D;
  pupils: THREE.Object3D[];
  eyes: THREE.Object3D[];
  flag: THREE.Mesh;
  flagBase: Float32Array;
  boostFlame: THREE.Mesh;
  boostGlow: THREE.Mesh;
  tubeMaterial: THREE.MeshPhysicalMaterial;
}

const OUTLINE: [number, number][] = [
  [0.0, 1.38],
  [0.36, 1.26],
  [0.62, 0.95],
  [0.76, 0.45],
  [0.8, -0.1],
  [0.78, -0.7],
  [0.7, -1.18],
  [0.42, -1.36],
  [0.0, -1.4],
];

function outlinePoints(scaleX: number, y: number): THREE.Vector3[] {
  const right = OUTLINE.map(([x, z]) => new THREE.Vector3(x * scaleX, y, z));
  const left = OUTLINE.slice(1, -1)
    .reverse()
    .map(([x, z]) => new THREE.Vector3(-x * scaleX, y, z));
  return [...right, ...left];
}

export function buildBoatMesh(team: Team, variant: number): BoatVisual {
  const colors = TEAM_COLORS[team];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const scaleX = 0.72;
  const tubeR = 0.36;

  // ---- inflatable tube
  const curve = new THREE.CatmullRomCurve3(outlinePoints(scaleX, 0.12), true, 'centripetal', 0.6);
  const tubeGeo = new THREE.TubeGeometry(curve, 96, tubeR, 20, true);
  const tubeTex = makeTubeTexture(variant === 0 ? colors.main : colors.main, colors.accent);
  const tubeMaterial = new THREE.MeshPhysicalMaterial({
    map: tubeTex,
    roughness: 0.32,
    metalness: 0.0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.18,
    sheen: 0.3,
    sheenColor: new THREE.Color(0xffffff),
  });
  const tube = new THREE.Mesh(tubeGeo, tubeMaterial);
  tube.castShadow = true;
  tube.receiveShadow = true;
  body.add(tube);

  // ---- hull / floor (extruded outline)
  const shape = new THREE.Shape();
  const inner = outlinePoints(scaleX * 0.92, 0);
  shape.moveTo(inner[0].x, inner[0].z);
  for (let i = 1; i < inner.length; i++) shape.lineTo(inner[i].x, inner[i].z);
  shape.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.42, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 2 });
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x2b3340, roughness: 0.85, metalness: 0.05 });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.rotation.x = Math.PI / 2; // shape (x,y) -> world (x, -, z); extrude goes downward
  hull.position.y = -0.08;
  hull.castShadow = true;
  hull.receiveShadow = true;
  body.add(hull);

  // deck pad for the "pilot"
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.9), new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.6 }));
  deck.position.set(0, -0.05, -0.2);
  body.add(deck);

  // ---- transom + outboard motor
  const transom = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.52, 0.12), new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.5 }));
  transom.position.set(0, 0.08, -1.42);
  transom.castShadow = true;
  body.add(transom);

  const motor = new THREE.Group();
  motor.position.set(0, 0.12, -1.55);
  const motorMat = new THREE.MeshPhysicalMaterial({ color: 0x1b1f28, roughness: 0.35, clearcoat: 0.8 });
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.46), motorMat);
  cowl.position.set(0, 0.32, -0.1);
  cowl.castShadow = true;
  motor.add(cowl);
  const cowlTop = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.4), new THREE.MeshStandardMaterial({ color: colors.main, roughness: 0.4 }));
  cowlTop.position.set(0, 0.54, -0.1);
  motor.add(cowlTop);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 10), motorMat);
  shaft.position.set(0, -0.22, -0.12);
  motor.add(shaft);
  const gearcase = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), motorMat);
  gearcase.scale.set(1, 0.8, 1.6);
  gearcase.position.set(0, -0.58, -0.12);
  motor.add(gearcase);
  const propeller = new THREE.Group();
  propeller.position.set(0, -0.58, -0.3);
  const bladeGeo = new THREE.BoxGeometry(0.04, 0.24, 0.1);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.6, roughness: 0.3 });
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.rotation.z = (i / 3) * Math.PI * 2;
    blade.rotation.x = 0.5;
    blade.position.set(Math.sin((i / 3) * Math.PI * 2) * -0.11, Math.cos((i / 3) * Math.PI * 2) * 0.11, 0);
    propeller.add(blade);
  }
  motor.add(propeller);
  body.add(motor);

  // ---- boost flame (additive) behind the motor
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const boostFlame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.6, 12, 1, true), flameMat);
  boostFlame.rotation.x = -Math.PI / 2;
  boostFlame.position.set(0, -0.1, -2.6);
  boostFlame.layers.set(OVERLAY_LAYER);
  boostFlame.visible = false;
  body.add(boostFlame);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const boostGlow = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), glowMat);
  boostGlow.position.set(0, -0.1, -1.85);
  boostGlow.layers.set(OVERLAY_LAYER);
  boostGlow.visible = false;
  body.add(boostGlow);

  // ---- face
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
  const eyeBlack = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.3 });
  const eyes: THREE.Object3D[] = [];
  const pupils: THREE.Object3D[] = [];
  for (const sx of [1, -1]) {
    const eye = new THREE.Group();
    eye.position.set(sx * 0.26, 0.5, 1.2);
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), eyeWhite);
    white.castShadow = true;
    eye.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), eyeBlack);
    pupil.position.set(0, 0.02, 0.12);
    eye.add(pupil);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), eyeWhite);
    glint.position.set(0.03, 0.05, 0.065);
    pupil.add(glint);
    body.add(eye);
    eyes.push(eye);
    pupils.push(pupil);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 20, Math.PI), new THREE.MeshStandardMaterial({ color: 0x3a1f1f, roughness: 0.6 }));
  mouth.position.set(0, 0.15, 1.7);
  mouth.rotation.z = Math.PI;
  body.add(mouth);
  const cheekMat = new THREE.MeshStandardMaterial({ color: 0xff8fa3, roughness: 0.7, transparent: true, opacity: 0.8 });
  for (const sx of [1, -1]) {
    const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), cheekMat);
    cheek.position.set(sx * 0.32, 0.22, 1.62);
    cheek.rotation.y = sx * 0.6;
    body.add(cheek);
  }

  // ---- flag on a pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0xf5f0e0, roughness: 0.5 }));
  pole.position.set(0.62 * scaleX + 0.1, 0.75, -1.1);
  body.add(pole);
  const flagGeo = new THREE.PlaneGeometry(0.62, 0.36, 10, 5);
  flagGeo.translate(0.31, 0, 0);
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: colors.accent, side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(pole.position.x, 1.15, pole.position.z);
  flag.rotation.y = Math.PI / 2;
  body.add(flag);
  const flagBase = new Float32Array((flagGeo.attributes.position as THREE.BufferAttribute).array);

  // player number decal on the transom
  const numCanvas = document.createElement('canvas');
  numCanvas.width = 128;
  numCanvas.height = 64;
  const ctx = numCanvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.font = 'bold 44px "Baloo 2", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#' + colors.main.toString(16).padStart(6, '0');
  ctx.fillText(String(variant + 1), 64, 48);
  const numTex = new THREE.CanvasTexture(numCanvas);
  numTex.colorSpace = THREE.SRGBColorSpace;
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshBasicMaterial({ map: numTex, transparent: true }));
  decal.position.set(0, 0.12, -1.49);
  decal.rotation.y = Math.PI;
  body.add(decal);

  return { root, body, propeller, motor, pupils, eyes, flag, flagBase, boostFlame, boostGlow, tubeMaterial };
}
