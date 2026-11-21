// Unit I: colour and blending. Hot exhaust: white-blue at birth, then orange,
// then nothing. Additive blending, so overlapping puffs brighten each other.

uniform vec3 uHotColor;
uniform vec3 uCoolColor;

varying float vAge01;
varying float vNearFade;

void main() {
  vec2 offset = gl_PointCoord - vec2(0.5);
  float radius = length(offset) * 2.0;
  if (radius > 1.0) discard;

  float soft = 1.0 - smoothstep(0.0, 1.0, radius);
  vec3 color = mix(uHotColor, uCoolColor, smoothstep(0.0, 0.45, vAge01));
  float fade = (1.0 - vAge01) * (1.0 - vAge01);
  gl_FragColor = vec4(color * soft * fade * vNearFade * 0.55, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
