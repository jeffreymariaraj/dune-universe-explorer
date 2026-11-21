// Unit V: object shape. GPU twin of fbm() / normalisedHeight() in
// src/physics/noise.ts — same octave loop, same per-octave shift, same seed
// offset (computed on the CPU and passed in), same sea-level clamp. That is how
// the rendered terrain and the collision height stay identical (CLAUDE.md).

#include ./simplex3d.glsl

uniform float uFrequency;
uniform int uOctaves;
uniform float uRidged;      // 0 or 1
uniform vec3 uSeedOffset;   // seedOffset(seed) from noise.ts
uniform float uSeaLevel;    // normalised height; -2.0 means "no sea"

const vec3 OCTAVE_SHIFT = vec3(19.1, 7.3, 11.7);

float heightFbm(vec3 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  float norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uOctaves) break;
    float v = snoise(p * frequency + OCTAVE_SHIFT * float(i));
    if (uRidged > 0.5) {
      v = 1.0 - abs(v);
      v = v * v * 2.0 - 1.0;
    }
    sum += v * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return sum / norm;
}

// Normalised height, about [-1, 1], at a unit direction in the planet's frame.
float rawHeight(vec3 dir) {
  return heightFbm(dir * uFrequency + uSeedOffset);
}

float planetHeight(vec3 dir) {
  return max(rawHeight(dir), uSeaLevel);
}
