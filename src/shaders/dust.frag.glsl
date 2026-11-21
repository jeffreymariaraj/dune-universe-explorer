// Unit I: blending. Soft round motes, alpha-blended (dust darkens as well as
// lightens, unlike the additive engine trail).

uniform vec3 uColor;
uniform float uOpacity;

varying float vFade;

void main() {
  float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (r > 1.0) discard;
  float alpha = (1.0 - r * r) * uOpacity * vFade;
  gl_FragColor = vec4(uColor, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
