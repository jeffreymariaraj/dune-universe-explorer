// Unit V: object shape and appearance — procedural detail without textures.
//
// Seeded 3D value noise and fractal Brownian motion (FBM), written for this
// project. Day 2 uses it only to colour planet surfaces so their spin is
// visible; Day 3 replaces it with the Ashima/stegu simplex noise that must
// match the CPU `simplex-noise` used for collision (CLAUDE.md).
//
// Included with `#include ./noise3d.glsl` (vite-plugin-glsl).

// Integer-free hash: cheap and stable across GPUs for the small inputs we use.
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// Trilinear interpolation of hashed lattice values, with a smooth (C1) fade.
float valueNoise(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);

  float n000 = hash13(cell + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(cell + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(cell + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(cell + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(cell + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(cell + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(cell + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(cell + vec3(1.0, 1.0, 1.0));

  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

// Sum of octaves, each at double the frequency and half the amplitude.
// `ridged` folds each octave (1 - |2n - 1|) to give sharp crests.
// Returns roughly [0, 1].
float fbm(vec3 p, int octaves, float ridged) {
  float sum = 0.0;
  float amplitude = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = valueNoise(p);
    n = mix(n, 1.0 - abs(2.0 * n - 1.0), ridged);
    sum += n * amplitude;
    norm += amplitude;
    p = p * 2.03 + vec3(17.1, -3.7, 9.2); // offset each octave to hide lattice
    amplitude *= 0.5;
  }
  return sum / max(norm, 1e-5);
}

// Map an integer seed from planets.json to a far-away offset in noise space,
// so each planet samples a different region of the same noise field.
vec3 seedOffset(float seed) {
  return vec3(
    fract(sin(seed * 12.9898) * 43758.5453),
    fract(sin(seed * 78.233) * 43758.5453),
    fract(sin(seed * 37.719) * 43758.5453)
  ) * 512.0;
}
