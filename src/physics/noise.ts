// Day 3. Unit V: object shape (procedural terrain) and physical modelling
// (the collision height must equal the rendered height).
//
// CPU twin of src/shaders/simplex3d.glsl + src/shaders/planetHeight.glsl.
// CLAUDE.md: "CPU and GPU noise must use the same seed and parameters, so
// collision height matches rendered height." Two different noise libraries can
// never agree value-for-value (npm `simplex-noise` builds a shuffled permutation
// table; the GLSL version uses a polynomial hash with no table), so instead this
// file is a line-by-line TypeScript port of the exact GLSL function. The seed is
// applied the same way on both sides: as an offset into noise space computed
// here (seedOffset) and passed to the shader as a uniform.
//
// Parity is checked in the browser by rendering the GLSL height into a float
// texture and comparing it with planetHeight() at the same directions.
//
// Simplex noise: adapted from Ashima Arts / Stefan Gustavson, "webgl-noise",
// noise3D.glsl, github.com/stegu/webgl-noise, MIT licence,
// Copyright (C) 2011 Ashima Arts; Copyright (C) 2011-2016 Stefan Gustavson.

/** generation.noise in planets.json, plus the biome's sea level. */
export interface HeightParams {
  /** Base frequency on the unit sphere. */
  frequency: number;
  /** Octaves of FBM, 1..8. */
  octaves: number;
  /** Peak displacement as a fraction of the planet radius. */
  amplitude: number;
  /** Folded "ridged" noise for sharp crests. */
  ridged: boolean;
  /** Offset into noise space derived from the seed (see seedOffset). */
  offset: readonly [number, number, number];
  /** Normalised height [-1, 1] below which terrain is flattened to water; null for none. */
  seaLevel: number | null;
}

// --------------------------------------------------------------- simplex 3D

function mod289(x: number): number {
  return x - Math.floor(x * (1 / 289)) * 289;
}

function permute(x: number): number {
  return mod289((x * 34 + 10) * x);
}

function taylorInvSqrt(r: number): number {
  return 1.79284291400159 - 0.85373472095314 * r;
}

/** GLSL step(edge, x). */
function step(edge: number, x: number): number {
  return x < edge ? 0 : 1;
}

/** 3D simplex noise in about [-1, 1]. Mirrors snoise() in simplex3d.glsl. */
export function snoise3(vx: number, vy: number, vz: number): number {
  const Cx = 1 / 6;
  const Cy = 1 / 3;

  // First corner
  const s = (vx + vy + vz) * Cy;
  let ix = Math.floor(vx + s);
  let iy = Math.floor(vy + s);
  let iz = Math.floor(vz + s);
  const t = (ix + iy + iz) * Cx;
  const x0x = vx - ix + t;
  const x0y = vy - iy + t;
  const x0z = vz - iz + t;

  // Other corners: g = step(x0.yzx, x0.xyz)
  const gx = step(x0y, x0x);
  const gy = step(x0z, x0y);
  const gz = step(x0x, x0z);
  const lx = 1 - gx;
  const ly = 1 - gy;
  const lz = 1 - gz;
  // i1 = min(g.xyz, l.zxy), i2 = max(g.xyz, l.zxy)
  const i1x = Math.min(gx, lz);
  const i1y = Math.min(gy, lx);
  const i1z = Math.min(gz, ly);
  const i2x = Math.max(gx, lz);
  const i2y = Math.max(gy, lx);
  const i2z = Math.max(gz, ly);

  const x1x = x0x - i1x + Cx;
  const x1y = x0y - i1y + Cx;
  const x1z = x0z - i1z + Cx;
  const x2x = x0x - i2x + Cy;
  const x2y = x0y - i2y + Cy;
  const x2z = x0z - i2z + Cy;
  const x3x = x0x - 0.5;
  const x3y = x0y - 0.5;
  const x3z = x0z - 0.5;

  // Permutations (no arrays: this runs ~150k times per surface chunk)
  ix = mod289(ix);
  iy = mod289(iy);
  iz = mod289(iz);
  const p0 = permute(permute(permute(iz) + iy) + ix);
  const p1 = permute(permute(permute(iz + i1z) + iy + i1y) + ix + i1x);
  const p2 = permute(permute(permute(iz + i2z) + iy + i2y) + ix + i2x);
  const p3 = permute(permute(permute(iz + 1) + iy + 1) + ix + 1);

  return (
    105 *
    (corner(p0, x0x, x0y, x0z) + corner(p1, x1x, x1y, x1z) + corner(p2, x2x, x2y, x2z) + corner(p3, x3x, x3y, x3z))
  );
}

// Math.fround: the GLSL constant 0.142857142857 is a 32-bit float, which is
// slightly MORE than 1/7, while the 64-bit literal is slightly LESS. Floors of
// j/7 at exact multiples of 7 would then disagree (2 on the GPU, 1 here) and
// pick a different gradient. Rounding the constant to float32 keeps parity.
const N7 = Math.fround(0.142857142857); // 1/7
// ns = n * D.wyz - D.xzx with D = (0, 0.5, 1, 2)
const NSX = N7 * 2;
const NSY = N7 * 0.5 - 1;
const NSZ = N7;

/**
 * One simplex corner: pick its gradient from the permutation value p (7x7
 * points over a square, folded onto an octahedron), normalise it, and weight
 * dot(gradient, offset) by the radial falloff max(0.5 - |offset|^2, 0)^4.
 */
function corner(p: number, dx: number, dy: number, dz: number): number {
  let m = 0.5 - (dx * dx + dy * dy + dz * dz);
  if (m <= 0) return 0;
  const j = p - 49 * Math.floor(p * NSZ * NSZ);
  const xq = Math.floor(j * NSZ);
  const yq = Math.floor(j - 7 * xq);
  let gx = xq * NSX + NSY;
  let gy = yq * NSX + NSY;
  const gz = 1 - Math.abs(gx) - Math.abs(gy);
  // b0 = (x, y); s = floor(b) * 2 + 1; sh = -step(h, 0); a = b + s * sh
  if (gz <= 0) {
    gx -= Math.floor(gx) * 2 + 1;
    gy -= Math.floor(gy) * 2 + 1;
  }
  const norm = taylorInvSqrt(gx * gx + gy * gy + gz * gz);
  m *= m;
  return m * m * norm * (gx * dx + gy * dy + gz * dz);
}

// --------------------------------------------------------------- planet height

/** Per-octave shift, so octaves do not line up at the origin. Same in GLSL. */
const OCTAVE_SHIFT = [19.1, 7.3, 11.7] as const;

/**
 * Fractal Brownian motion: octaves at doubling frequency and halving amplitude,
 * normalised to about [-1, 1]. Ridged mode folds each octave to 1 - |n|,
 * squares it for sharp crests, and maps it back to [-1, 1].
 * Mirrors heightFbm() in planetHeight.glsl.
 */
export function fbm(x: number, y: number, z: number, octaves: number, ridged: boolean): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  const count = Math.max(1, Math.min(8, Math.round(octaves)));
  for (let i = 0; i < count; i++) {
    let v = snoise3(
      x * frequency + OCTAVE_SHIFT[0] * i,
      y * frequency + OCTAVE_SHIFT[1] * i,
      z * frequency + OCTAVE_SHIFT[2] * i,
    );
    if (ridged) {
      v = 1 - Math.abs(v);
      v = v * v * 2 - 1;
    }
    sum += v * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}

/**
 * Normalised terrain height in about [-1, 1] at a unit direction from the
 * planet centre, in the planet's own (spinning) frame. Water is flat at sea level.
 */
export function normalisedHeight(dx: number, dy: number, dz: number, params: HeightParams): number {
  const [ox, oy, oz] = params.offset;
  const f = params.frequency;
  const h = fbm(dx * f + ox, dy * f + oy, dz * f + oz, params.octaves, params.ridged);
  return params.seaLevel === null ? h : Math.max(h, params.seaLevel);
}

/**
 * Surface radius in world units at a unit direction: radius * (1 + amplitude * h).
 * This is the function Day 7/8 collision and landing will call.
 */
export function surfaceRadius(dx: number, dy: number, dz: number, radius: number, params: HeightParams): number {
  return radius * (1 + params.amplitude * normalisedHeight(dx, dy, dz, params));
}

/**
 * Deterministic 32-bit PRNG (mulberry32): same seed, same sequence, on every
 * run and machine. Everything procedural in the game is seeded through this.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seed -> offset into noise space, in [0, 64)^3. Kept small on purpose: the GPU
 * works in 32-bit floats, and a large offset would cost precision (and parity).
 */
export function seedOffset(seed: number): [number, number, number] {
  const next = createRandom(seed);
  return [next() * 64, next() * 64, next() * 64];
}
