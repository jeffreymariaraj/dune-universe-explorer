// Unit V: visual appearance. Unit I: colour.
//
// Surface sky from the planet's atmosphere colour (planets.json):
//   * vertical gradient: horizon colour near the ground, deeper zenith above
//   * the sun: a hard disc plus a soft glow around it, from the direction the
//     landing site faced the star when you landed
//   * night: the gradient fades to near-black and procedural stars appear
//     (a hash of the view direction, so they are fixed in the sky)
// Below the horizon the colour is the horizon colour, which is also the fog
// colour, so distant terrain melts into the sky with no visible seam.

uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uNight;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uDaylight;   // 0 night .. 1 day

varying vec3 vDirection;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 dir = normalize(vDirection);
  float up = clamp(dir.y, 0.0, 1.0);

  vec3 day = mix(uHorizon, uZenith, pow(up, 0.55));
  vec3 night = mix(uNight * 1.6, uNight, up);
  vec3 color = mix(night, day, uDaylight);

  // Sun: disc + glow, only above the horizon.
  float facing = max(dot(dir, normalize(uSunDirection)), 0.0);
  float disc = smoothstep(0.9993, 0.9997, facing);
  float glow = pow(facing, 12.0) * 0.45 + pow(facing, 200.0) * 0.8;
  float aboveHorizon = smoothstep(-0.02, 0.03, uSunDirection.y);
  color += uSunColor * (disc * 6.0 + glow) * aboveHorizon;

  // Stars at night (fade out with daylight and towards the hazy horizon).
  vec3 cell = floor(dir * 260.0);
  float star = step(0.9965, hash31(cell)) * smoothstep(0.05, 0.3, dir.y);
  color += vec3(0.9, 0.95, 1.0) * star * (1.0 - uDaylight) * 1.5;

  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
