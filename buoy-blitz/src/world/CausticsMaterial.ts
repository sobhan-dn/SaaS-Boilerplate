import * as THREE from 'three';

/**
 * Wraps a MeshStandardMaterial so its albedo is modulated by animated, procedural light caustics.
 * Used on everything that sits under the water surface.
 */
export function makeCausticsMaterial(params: THREE.MeshStandardMaterialParameters, strength = 0.75, scale = 0.32): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial(params);
  const uniforms = {
    uCausticTime: { value: 0 },
    uCausticStrength: { value: strength },
    uCausticScale: { value: scale },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCausticPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCausticPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vCausticPos;
uniform float uCausticTime;
uniform float uCausticStrength;
uniform float uCausticScale;
float causticPattern(vec2 p, float t) {
  float a = 0.0;
  vec2 q = p;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 d = vec2(sin(q.y * 1.7 + t * 0.9 + fi), cos(q.x * 1.3 - t * 0.7 + fi * 2.0));
    q += d * 0.35;
    float v = sin(q.x * 2.1 + t * 0.8) * sin(q.y * 1.9 - t * 1.1);
    a += 1.0 - abs(v);
  }
  a /= 3.0;
  return pow(a, 5.0);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  float c1 = causticPattern(vCausticPos.xz * uCausticScale, uCausticTime);
  float c2 = causticPattern(vCausticPos.xz * uCausticScale * 1.9 + 3.1, uCausticTime * 1.3 + 2.0);
  float depthFade = clamp((0.5 - vCausticPos.y) * 0.08, 0.0, 1.0);
  diffuseColor.rgb *= 1.0 + (c1 * 0.7 + c2 * 0.45) * uCausticStrength * (0.6 + 0.4 * depthFade);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'caustics';
  (mat as unknown as { causticUniforms: typeof uniforms }).causticUniforms = uniforms;
  return mat;
}

export function updateCaustics(mat: THREE.Material, time: number) {
  const u = (mat as unknown as { causticUniforms?: { uCausticTime: { value: number } } }).causticUniforms;
  if (u) u.uCausticTime.value = time;
}
