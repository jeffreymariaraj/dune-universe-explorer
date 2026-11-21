// Unit I: colour. Unit V: visual appearance.
//
// The star is self-luminous, so there is no N.L lighting. Instead:
//   * limb darkening: the disc is dimmer at the edge, I = 1 - u (1 - mu),
//     where mu = N.V is the cosine of the viewing angle at that point;
//   * slowly churning granulation from animated value noise.
// Colours go above 1.0 (HDR) on purpose: tone mapping rolls them off to white
// today, and Day 6's bloom pass will pick them up.

#include ./noise3d.glsl

uniform vec3 uColor;
uniform float uTime;
uniform float uIntensity;

varying vec3 vObjectNormal;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPosition);
  float mu = clamp(dot(N, V), 0.0, 1.0);
  float limb = 1.0 - 0.6 * (1.0 - mu);

  vec3 p = normalize(vObjectNormal) * 6.0;
  float granules = fbm(p + vec3(0.0, uTime * 0.05, uTime * 0.03), 4, 0.0);
  vec3 hot = uColor * (0.85 + 0.35 * granules);
  vec3 edge = uColor * vec3(1.0, 0.62, 0.32); // cooler, redder limb

  vec3 color = mix(edge, hot, limb) * limb * uIntensity;
  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
