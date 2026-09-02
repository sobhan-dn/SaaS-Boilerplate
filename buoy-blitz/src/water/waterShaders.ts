import { WAVE_COUNT } from './WaveModel';

export const waterVertexShader = /* glsl */ `
#define WAVE_COUNT ${WAVE_COUNT}
uniform float uTime;
uniform vec2 uWaveDir[WAVE_COUNT];
uniform vec4 uWaveParams[WAVE_COUNT]; // amplitude, k, omega, q
uniform vec2 uArenaHalf;
uniform sampler2D uRipple;
uniform vec2 uRippleHalf;
uniform float uRippleScale;

varying vec3 vWorldPos;
varying vec3 vWaveNormal;
varying float vWaveHeight;
varying float vJacobian;
varying vec2 vRippleUv;

float oceanScale(vec2 p) {
  vec2 d = max(vec2(0.0), abs(p) - uArenaHalf);
  float s = clamp(length(d) / 45.0, 0.0, 1.0);
  return 1.0 + 2.6 * s * s * (3.0 - 2.0 * s);
}

void main() {
  vec3 p0 = (modelMatrix * vec4(position, 1.0)).xyz;
  vec2 xz = p0.xz;
  float scale = oceanScale(xz);
  vec3 disp = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  float jxx = 1.0, jzz = 1.0, jxz = 0.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec2 D = uWaveDir[i];
    vec4 P = uWaveParams[i];
    float amp = P.x * scale;
    float k = P.y;
    float w = P.z;
    float q = P.w;
    float f = k * dot(D, xz) - w * uTime;
    float c = cos(f);
    float s = sin(f);
    disp.x += q * amp * D.x * c;
    disp.z += q * amp * D.y * c;
    disp.y += amp * s;
    float wa = k * amp;
    n.x -= D.x * wa * c;
    n.z -= D.y * wa * c;
    n.y -= q * wa * s;
    jxx -= q * D.x * D.x * wa * s;
    jzz -= q * D.y * D.y * wa * s;
    jxz -= q * D.x * D.y * wa * s;
  }
  vRippleUv = xz / (uRippleHalf * 2.0) + 0.5;
  float ripple = 0.0;
  if (all(greaterThan(vRippleUv, vec2(0.0))) && all(lessThan(vRippleUv, vec2(1.0)))) {
    ripple = texture2D(uRipple, vRippleUv).r * uRippleScale;
  }
  vec3 wp = p0 + disp;
  wp.y += ripple;
  vWorldPos = wp;
  vWaveNormal = normalize(n);
  vWaveHeight = disp.y;
  vJacobian = jxx * jzz - jxz * jxz;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const waterFragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uCameraPos;
uniform vec3 uCameraForward;
uniform float uCameraNear;
uniform float uCameraFar;
uniform vec2 uResolution;

uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform sampler2D uReflection;
uniform mat4 uReflectionMatrix;
uniform float uReflectionEnabled;

uniform sampler2D uNormalMap;
uniform sampler2D uFoamMap;
uniform sampler2D uRipple;
uniform vec2 uRippleTexel;
uniform vec2 uRippleTexelWorld;
uniform float uRippleScale;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uScatterColor;
uniform vec3 uAbsorption;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uDetailStrength;
uniform float uRefractStrength;
uniform float uReflectDistort;

varying vec3 vWorldPos;
varying vec3 vWaveNormal;
varying float vWaveHeight;
varying float vJacobian;
varying vec2 vRippleUv;

float linearizeDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uCameraNear * uCameraFar) / (uCameraFar + uCameraNear - z * (uCameraFar - uCameraNear));
}

void main() {
  vec2 screenUv = gl_FragCoord.xy / uResolution;
  float sceneRaw = texture2D(uSceneDepth, screenUv).r;
  if (sceneRaw < gl_FragCoord.z) discard;

  vec3 toCam = uCameraPos - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float rayRatio = 1.0 / max(dot(-V, uCameraForward), 0.15);
  float waterViewZ = linearizeDepth(gl_FragCoord.z);
  float sceneViewZ = linearizeDepth(sceneRaw);
  float thickness = max(sceneViewZ - waterViewZ, 0.0) * rayRatio;

  // --- normals: gerstner + scrolling detail + interactive ripples
  float detailFade = 1.0 / (1.0 + dist * 0.012);
  vec3 d1 = texture2D(uNormalMap, vWorldPos.xz * 0.085 + vec2(uTime * 0.017, uTime * 0.011)).xyz * 2.0 - 1.0;
  vec3 d2 = texture2D(uNormalMap, vWorldPos.xz * 0.21 + vec2(-uTime * 0.023, uTime * 0.019)).xyz * 2.0 - 1.0;
  vec3 d3 = texture2D(uNormalMap, vWorldPos.xz * 0.5 + vec2(uTime * 0.04, -uTime * 0.03)).xyz * 2.0 - 1.0;
  vec2 detail = (d1.xy * 0.55 + d2.xy * 0.3 + d3.xy * 0.15) * uDetailStrength * detailFade;

  float inRipple = step(0.0, vRippleUv.x) * step(vRippleUv.x, 1.0) * step(0.0, vRippleUv.y) * step(vRippleUv.y, 1.0);
  float rC = texture2D(uRipple, vRippleUv).r;
  float rL = texture2D(uRipple, vRippleUv - vec2(uRippleTexel.x, 0.0)).r;
  float rR = texture2D(uRipple, vRippleUv + vec2(uRippleTexel.x, 0.0)).r;
  float rD = texture2D(uRipple, vRippleUv - vec2(0.0, uRippleTexel.y)).r;
  float rU = texture2D(uRipple, vRippleUv + vec2(0.0, uRippleTexel.y)).r;
  vec2 rippleN = vec2((rL - rR) / (2.0 * uRippleTexelWorld.x), (rD - rU) / (2.0 * uRippleTexelWorld.y)) * uRippleScale * inRipple;

  vec3 N = normalize(vec3(vWaveNormal.x + detail.x + rippleN.x, vWaveNormal.y, vWaveNormal.z + detail.y + rippleN.y));
  vec3 Nspec = normalize(vec3(vWaveNormal.x + detail.x * 1.6 + rippleN.x, vWaveNormal.y, vWaveNormal.z + detail.y * 1.6 + rippleN.y));

  // --- refraction
  float distortAmount = uRefractStrength * clamp(thickness * 0.6, 0.0, 1.0) / max(waterViewZ * 0.04, 1.0);
  vec2 refrUv = screenUv + (N.xz + rippleN * 2.0) * distortAmount;
  refrUv = clamp(refrUv, vec2(0.002), vec2(0.998));
  float refrRaw = texture2D(uSceneDepth, refrUv).r;
  if (refrRaw < gl_FragCoord.z) {
    refrUv = screenUv;
    refrRaw = sceneRaw;
  }
  vec3 refrColor = texture2D(uSceneColor, refrUv).rgb;
  float refrThickness = max(linearizeDepth(refrRaw) - waterViewZ, 0.0) * rayRatio;
  vec3 transmittance = exp(-uAbsorption * refrThickness);
  vec3 sunLit = uSunColor * (0.35 + 0.65 * max(uSunDir.y, 0.0)) + uAmbient;
  vec3 scatter = uScatterColor * sunLit;
  vec3 refracted = refrColor * transmittance + scatter * (1.0 - transmittance);

  // --- reflection
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 skyRefl = mix(uSkyHorizon, uSkyZenith, pow(clamp(R.y, 0.0, 1.0), 0.6));
  vec4 rp = uReflectionMatrix * vec4(vWorldPos, 1.0);
  vec2 ruv = rp.xy / rp.w;
  ruv += N.xz * uReflectDistort * vec2(1.0, 2.0) / max(waterViewZ * 0.02, 1.0);
  float inReflection = step(0.0, ruv.x) * step(ruv.x, 1.0) * step(0.0, ruv.y) * step(ruv.y, 1.0);
  vec3 reflTex = texture2D(uReflection, clamp(ruv, 0.001, 0.999)).rgb;
  vec3 reflection = mix(skyRefl, reflTex, uReflectionEnabled * inReflection);

  // --- fresnel
  float ndv = max(dot(N, V), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  fresnel = clamp(fresnel, 0.02, 1.0);

  // --- sun
  vec3 H = normalize(uSunDir + V);
  float ndh = max(dot(Nspec, H), 0.0);
  float hdv = max(dot(H, V), 0.0);
  float specF = 0.04 + 0.96 * pow(1.0 - hdv, 5.0);
  float spec = pow(ndh, 900.0) * 4.5 + pow(ndh, 120.0) * 0.35 + pow(ndh, 16.0) * 0.03;
  vec3 specular = uSunColor * spec * specF * clamp(uSunDir.y * 6.0, 0.0, 1.0);

  // --- subsurface scattering on crests
  float crest = clamp(vWaveHeight * 2.2 + 0.35, 0.0, 1.0);
  float backlit = pow(max(dot(-V, uSunDir), 0.0), 4.0);
  vec3 sss = uScatterColor * uSunColor * crest * (0.08 + 0.9 * backlit) * (1.0 - fresnel) * clamp(thickness * 0.3, 0.0, 1.0);

  // --- foam
  float f1 = texture2D(uFoamMap, vWorldPos.xz * 0.11 + vec2(uTime * 0.012, -uTime * 0.008)).r;
  float f2 = texture2D(uFoamMap, vWorldPos.xz * 0.29 + vec2(-uTime * 0.02, uTime * 0.015)).r;
  float foamNoise = f1 * 0.6 + f2 * 0.4;
  float shoreFoam = 1.0 - smoothstep(0.0, 1.1, thickness);
  float crestFoam = smoothstep(0.75, 0.25, vJacobian);
  float rippleMag = abs(rC) * uRippleScale * inRipple;
  float rippleSlope = length(rippleN);
  float rippleFoam = smoothstep(0.03, 0.14, rippleMag) * 0.9 + smoothstep(0.25, 0.9, rippleSlope) * 0.6;
  float foam = clamp(shoreFoam * 1.3 + crestFoam + rippleFoam, 0.0, 1.0);
  foam *= smoothstep(0.32, 0.72, foamNoise + foam * 0.45);
  vec3 foamColor = vec3(0.92, 0.96, 1.0) * (uAmbient * 1.2 + uSunColor * (0.3 + 0.7 * max(dot(N, uSunDir), 0.0)));

  vec3 color = mix(refracted, reflection, fresnel) + specular + sss;
  color = mix(color, foamColor, foam);

  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  color = mix(color, uFogColor, clamp(fogF, 0.0, 1.0));

  gl_FragColor = vec4(color, 1.0);
}
`;

export const rippleSimShader = /* glsl */ `
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform float uDamping;
uniform vec4 uEmitters[12]; // uv.x, uv.y, radius(uv units, x-scaled), strength
uniform int uEmitterCount;
uniform float uAspect; // width / height of the sim region
varying vec2 vUv;

void main() {
  vec4 c = texture2D(uPrev, vUv);
  float h = c.r;
  float hPrev = c.g;
  float sum = texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)).r
            + texture2D(uPrev, vUv - vec2(uTexel.x, 0.0)).r
            + texture2D(uPrev, vUv + vec2(0.0, uTexel.y)).r
            + texture2D(uPrev, vUv - vec2(0.0, uTexel.y)).r;
  float newH = (sum * 0.5 - hPrev) * uDamping;
  for (int i = 0; i < 12; i++) {
    if (i >= uEmitterCount) break;
    vec4 e = uEmitters[i];
    vec2 d = (vUv - e.xy) * vec2(uAspect, 1.0);
    float r = e.z;
    float w = exp(-dot(d, d) / (r * r));
    newH += e.w * w;
  }
  float edge = smoothstep(0.0, 0.04, vUv.x) * smoothstep(0.0, 0.04, 1.0 - vUv.x)
             * smoothstep(0.0, 0.03, vUv.y) * smoothstep(0.0, 0.03, 1.0 - vUv.y);
  newH *= edge;
  newH = clamp(newH, -2.5, 2.5);
  gl_FragColor = vec4(newH, h, 0.0, 1.0);
}
`;

export const fullscreenVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** GLSL3: copies scene color and re-emits scene depth so later passes depth-test against it. */
export const copyDepthFragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform highp sampler2D tDepth;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
  gl_FragDepth = texture2D(tDepth, vUv).r;
}
`;
