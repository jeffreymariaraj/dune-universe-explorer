// Unit V: particle systems. Motes wrapped into a box that follows the camera:
// each mote drifts with the wind, and mod() folds it back into the box around
// the camera, so a fixed set of particles fills the air wherever you walk.

uniform float uTime;
uniform vec3 uWind;
uniform vec3 uCameraPos;
uniform float uExtent;
uniform float uSize;
uniform float uViewportHeight;

attribute float aPhase;

varying float vFade;

void main() {
  vec3 drift = position + uWind * uTime + vec3(sin(uTime * 0.7 + aPhase), 0.0, cos(uTime * 0.5 + aPhase)) * 0.6;
  vec3 local = mod(drift - uCameraPos + 0.5 * uExtent, uExtent) - 0.5 * uExtent;
  vec3 world = uCameraPos + local;
  vec4 view = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * view;

  float depth = max(-view.z, 0.001);
  gl_PointSize = min(uSize * projectionMatrix[1][1] * 0.5 * uViewportHeight / depth, 24.0);
  // Fade at the box edge (no popping) and right in front of the lens.
  vFade = (1.0 - smoothstep(0.35 * uExtent, 0.5 * uExtent, length(local))) * smoothstep(0.3, 2.0, depth);
}
