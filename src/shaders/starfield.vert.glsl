// Unit I: vertex processing and point primitives.
// Unit IV: the viewing pipeline made explicit — this is the model-view-projection
// chain that three.js normally hides inside a built-in material.
//
// Used for two layers (see Skybox.ts):
//   uWrapExtent <= 0  ->  SKY SHELL: stars on a sphere, drawn with depth test off
//                         and re-centred on the camera, so it behaves as a skybox.
//   uWrapExtent >  0  ->  PARALLAX DUST: motes wrapped into a cube centred on the
//                         camera, so the field is effectively infinite and you can
//                         see your own motion against it.

attribute float aSize;      // base pixel size
attribute float aTwinkle;   // per-star phase, so they do not blink in unison
attribute vec3 aColor;      // blue-white through to amber

uniform float uTime;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uWrapExtent;   // cube side length for the dust layer, 0 for the shell
uniform vec3 uCameraPos;     // world-space camera position
uniform float uFadeDistance; // distance at which motes have faded out, 0 to disable
uniform float uSizeRef;      // distance at which a star draws at its base size

varying vec3 vColor;
varying float vBrightness;

void main() {
  vec3 worldOffset = position;

  if (uWrapExtent > 0.0) {
    // Tile the field around the camera: each mote is folded into the cube
    // [-extent/2, extent/2] relative to the camera, in world space.
    vec3 relative = position - uCameraPos;
    // "half" is a reserved word in GLSL ES, hence halfExtent.
    vec3 halfExtent = vec3(uWrapExtent * 0.5);
    relative = mod(relative + halfExtent, vec3(uWrapExtent)) - halfExtent;
    worldOffset = uCameraPos + relative;
  }

  // modelViewMatrix = view * model, then the projection matrix: the standard chain.
  vec4 viewPosition = modelViewMatrix * vec4(worldOffset, 1.0);
  gl_Position = projectionMatrix * viewPosition;

  float twinkle = 0.75 + 0.25 * sin(uTime * 1.7 + aTwinkle * 6.2831853);

  // Fade motes out near the edge of the wrap cube so they do not pop in.
  float fade = 1.0;
  if (uFadeDistance > 0.0) {
    fade = 1.0 - smoothstep(uFadeDistance * 0.55, uFadeDistance, length(worldOffset - uCameraPos));
  }

  vBrightness = twinkle * fade;
  vColor = aColor;

  // Perspective size attenuation, as in three's sizeAttenuation. uSizeRef is the
  // distance at which a star draws at exactly aSize pixels: set it to the shell
  // radius and the sky keeps its star-size variation however far away the shell
  // sits, while the dust layer uses a short reference so motes grow as you pass.
  float viewDistance = max(-viewPosition.z, 0.001);
  float size = aSize * uSizeScale * uPixelRatio * (uSizeRef / viewDistance) * twinkle;
  gl_PointSize = clamp(size, 0.6, 7.0);
}
