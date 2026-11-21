// Unit V: visual appearance. Unit I: HDR colour and additive blending.
//
// A thin disk of hot gas around the anomaly. Three ideas, all cheap:
//   * temperature: hottest at the inner edge (blue-white), cooling outward
//     through yellow and orange to dull red — a blackbody-style ramp
//   * differential rotation: inner gas orbits faster (angular speed ~ r^-1.5,
//     Kepler's third law), so the noise pattern shears into spiral streaks
//   * relativistic beaming: the side moving towards the camera is brighter
//     (~ (1 + beta cos theta)^3), the receding side dimmer
// Output goes above 1.0 on purpose so the bloom pass makes it glow.

#include ./noise3d.glsl

uniform float uTime;
uniform float uInner;
uniform float uOuter;
uniform float uIntensity;
uniform float uBeaming;     // 0 = off, ~0.6 = strong

varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vVelocityDir;

vec3 temperatureRamp(float t) {
  // t = 0 at the inner edge (hottest), 1 at the outer edge.
  vec3 white = vec3(1.0, 0.95, 0.9);
  vec3 yellow = vec3(1.0, 0.72, 0.32);
  vec3 orange = vec3(0.95, 0.38, 0.1);
  vec3 red = vec3(0.45, 0.08, 0.04);
  vec3 c = mix(white, yellow, smoothstep(0.0, 0.25, t));
  c = mix(c, orange, smoothstep(0.2, 0.55, t));
  return mix(c, red, smoothstep(0.5, 1.0, t));
}

void main() {
  float r = length(vLocal.xz);
  float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
  float angle = atan(-vLocal.z, vLocal.x);

  // Kepler shear: angular position advances as t * r^-1.5.
  float omega = 1.6 * pow(uInner / r, 1.5);
  float phase = angle - uTime * omega;
  vec3 p = vec3(cos(phase) * r, sin(phase) * r, r * 2.0) * 0.012;
  float gas = valueNoise(p) * 0.6 + valueNoise(p * 2.7 + 5.0) * 0.4;
  float streaks = 0.55 + 0.9 * gas;

  // Soft edges: a sharp-ish inner rim, a long fade outward.
  float edge = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.65, 1.0, t));
  float density = edge * pow(1.0 - t, 1.3) * streaks;

  vec3 viewDir = normalize(cameraPosition - vWorld);
  float approach = dot(vVelocityDir, viewDir);           // +1 coming at us
  float beaming = pow(max(1.0 + uBeaming * approach, 0.05), 3.0);

  vec3 color = temperatureRamp(t) * density * beaming * uIntensity;
  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
