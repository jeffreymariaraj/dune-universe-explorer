// Unit IV: visible-surface detection, made visible. Shows the depth buffer
// that the z-test used to decide which surface wins each pixel.
//
// The stored depth is non-linear (most of its precision sits near the camera),
// so it is converted back to a view-space distance and drawn on a log scale:
// near = white, far = black. Objects that do not write depth (stars, the
// accretion disk, particles) vanish: they never take part in the z-test.

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float distance = -getViewZ(depth);
  float shade = 1.0 - log(1.0 + distance) / log(1.0 + cameraFar);
  outputColor = vec4(vec3(shade), 1.0);
}
