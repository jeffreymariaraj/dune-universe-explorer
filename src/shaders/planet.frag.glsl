// Unit I: fragment processing and colour. Unit V: visual appearance.
//
// Colour: the biome palette ramp by terrain height, flat water below the sea
// level (tinted by depth), polar ice by latitude, plus a little fine value
// noise so the surface does not look smeared between vertices.
//
// Day/night (SYSTEM_DESIGN.md section 6): Lambert N.L on the day side; nearly
// black on the night side with emissive city lights where planets.json sets
// nightLights; smoothstep over N.L for a soft terminator, tinted with the
// atmosphere colour in a narrow twilight band. Water and ice add a Blinn-Phong
// glint of the star.

#include ./noise3d.glsl

uniform vec3 uPalette[3];          // low, mid, high ground (linear RGB)
uniform vec3 uWaterDeep;
uniform vec3 uWaterShallow;
uniform float uSeaLevel;           // -2.0 = no sea
uniform float uLandRampStart;      // where land starts on the palette ramp
uniform float uPolarCap;           // |sin latitude| for ice; 2.0 = none
uniform float uSpecular;
uniform vec3 uStarPosition;        // world space
uniform vec3 uStarColor;
uniform vec3 uAtmosphereColor;
uniform float uAtmosphereDensity;
uniform float uSeed;
uniform float uNightLights;        // 0 or 1
uniform float uTerminatorWidth;    // in units of N.L, e.g. 0.12
uniform float uAmbient;            // floor so the night side is not pure black

varying vec3 vObjectDir;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying float vHeight;
varying float vRawHeight;

vec3 paletteRamp(float t) {
  vec3 lowToMid = mix(uPalette[0], uPalette[1], smoothstep(0.0, 0.5, t));
  return mix(lowToMid, uPalette[2], smoothstep(0.5, 1.0, t));
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 L = normalize(uStarPosition - vWorldPosition);
  vec3 V = normalize(cameraPosition - vWorldPosition);
  float ndl = dot(N, L);

  vec3 dir = normalize(vObjectDir);
  vec3 detailPoint = dir * 48.0 + seedOffset(uSeed);
  float detail = valueNoise(detailPoint) * 0.6 + valueNoise(detailPoint * 3.1) * 0.4;

  // --- albedo ---------------------------------------------------------------
  bool hasSea = uSeaLevel > -1.5;
  float isWater = hasSea ? step(vRawHeight, uSeaLevel) : 0.0;

  // Land: map [sea level or -1, 1] onto [uLandRampStart, 1] of the ramp.
  float landFloor = hasSea ? uSeaLevel : -1.0;
  float t = clamp((vHeight - landFloor) / (1.0 - landFloor), 0.0, 1.0);
  t = mix(uLandRampStart, 1.0, clamp(t * 1.35, 0.0, 1.0));
  vec3 land = paletteRamp(t) * (0.9 + 0.2 * detail);

  // Water: deeper is darker.
  float depth = hasSea ? clamp((uSeaLevel - vRawHeight) * 4.0, 0.0, 1.0) : 0.0;
  vec3 water = mix(uWaterShallow, uWaterDeep, depth);

  vec3 albedo = mix(land, water, isWater);

  // Polar ice by latitude (planet frame, so it follows the tilt), raggedly.
  float latitude = abs(dir.y) + (detail - 0.5) * 0.08 + vHeight * 0.05;
  float ice = smoothstep(uPolarCap - 0.03, uPolarCap + 0.02, latitude);
  albedo = mix(albedo, vec3(0.92, 0.95, 1.0), ice);

  // --- lighting -------------------------------------------------------------
  float day = smoothstep(-uTerminatorWidth, uTerminatorWidth, ndl);
  float lambert = max(ndl, 0.0);
  vec3 dayColor = albedo * uStarColor * (lambert * 1.15 + 0.04);

  // Sun glint on water and ice (Blinn-Phong half vector).
  vec3 H = normalize(L + V);
  float shiny = max(isWater, ice * 0.5);
  float glint = pow(max(dot(N, H), 0.0), 90.0) * uSpecular * shiny * step(0.0, ndl);
  dayColor += uStarColor * glint;

  // Twilight band around N.L = 0.
  float twilight = 1.0 - smoothstep(0.0, uTerminatorWidth * 1.5, abs(ndl));
  dayColor += uAtmosphereColor * twilight * 0.18 * uAtmosphereDensity;

  // Night side: faint albedo, plus city lights on land.
  vec3 nightColor = albedo * uAmbient;
  if (uNightLights > 0.5) {
    // Regions (low frequency) times settlements (high frequency): clusters of
    // small lights rather than one big glowing blob.
    vec3 p = dir * 7.0 + seedOffset(uSeed + 1.0);
    float regions = smoothstep(0.45, 0.7, valueNoise(p));
    float towns = smoothstep(0.62, 0.85, valueNoise(p * 9.0 + 3.1));
    float lit = regions * towns * (1.0 - isWater) * (1.0 - ice);
    nightColor += vec3(1.0, 0.72, 0.38) * lit * 1.6;
  }

  vec3 color = mix(nightColor, dayColor, day);

  // Haze over the disc near the limb (the atmosphere shell glows beyond it).
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  color += uAtmosphereColor * rim * uAtmosphereDensity * 0.3 * smoothstep(-0.2, 0.3, ndl);

  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
