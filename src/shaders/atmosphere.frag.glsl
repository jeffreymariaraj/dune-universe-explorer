// Unit V: visual appearance. Unit I: blending.
//
// The atmosphere is a sphere slightly larger than the planet, drawn with its
// BACK faces only and additive blending. For each pixel we take the view ray
// from the camera and find its closest approach d to the planet centre:
//
//   depth = (R_atmosphere - d) / (R_atmosphere - R_planet), clamped to [0, 1]
//
// so the glow is strongest just above the surface at the limb and fades to
// nothing at the shell's edge — a cheap stand-in for integrating air density
// along the ray. Rays that hit the planet are hidden by the depth test (the
// planet is opaque and drawn first). The glow is lit by the star at the point of
// closest approach, with a forward-scattering boost when looking towards the
// star through the limb, which produces the bright rim around a backlit planet.

uniform vec3 uPlanetCenter;       // world space
uniform float uPlanetRadius;
uniform float uAtmosphereRadius;
uniform vec3 uStarPosition;
uniform vec3 uColor;
uniform float uDensity;

varying vec3 vWorldPosition;

void main() {
  vec3 rayDir = normalize(vWorldPosition - cameraPosition);
  float t = max(dot(uPlanetCenter - cameraPosition, rayDir), 0.0);
  vec3 closest = cameraPosition + rayDir * t;
  float d = length(closest - uPlanetCenter);

  float thickness = uAtmosphereRadius - uPlanetRadius;
  float depth = clamp((uAtmosphereRadius - d) / thickness, 0.0, 1.0);
  float glow = pow(depth, 2.2);

  vec3 up = normalize(closest - uPlanetCenter + vec3(1e-4));
  vec3 L = normalize(uStarPosition - closest);
  float lit = smoothstep(-0.35, 0.5, dot(up, L));
  float forward = pow(max(dot(rayDir, L), 0.0), 8.0);

  vec3 color = uColor * glow * uDensity * (lit * 1.1 + forward * 1.6);
  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
