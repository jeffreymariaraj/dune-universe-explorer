// Unit I: fragment processing and colour.
// Turns each square point sprite into a soft round star with no texture fetch.

varying vec3 vColor;
varying float vBrightness;

void main() {
  // gl_PointCoord is 0..1 across the sprite; distance from its centre gives a disc.
  vec2 offset = gl_PointCoord - vec2(0.5);
  float radius = length(offset) * 2.0;
  if (radius > 1.0) discard;

  // Smooth core plus a faint halo, so bright stars read as bright.
  float core = 1.0 - smoothstep(0.0, 0.45, radius);
  float halo = (1.0 - smoothstep(0.3, 1.0, radius)) * 0.35;
  float alpha = clamp(core + halo, 0.0, 1.0) * vBrightness;

  gl_FragColor = vec4(vColor * vBrightness, alpha);
}
