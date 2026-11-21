import { describe, expect, it } from 'vitest';
import { fbm, normalisedHeight, seedOffset, snoise3, surfaceRadius, type HeightParams } from './noise';

/** Deterministic sample points spread through noise space. */
function samples(count: number, scale: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    out.push([Math.sin(i * 12.9898) * scale, Math.cos(i * 78.233) * scale, Math.sin(i * 37.719 + 1) * scale]);
  }
  return out;
}

/** Unit vectors spread over the sphere (Fibonacci lattice). */
function directions(count: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(golden * i) * r, y, Math.sin(golden * i) * r]);
  }
  return out;
}

const ARRAKIS: HeightParams = {
  frequency: 1.4,
  octaves: 6,
  amplitude: 0.06,
  ridged: false,
  offset: seedOffset(7041),
  seaLevel: null,
};

describe('snoise3 (CPU port of Ashima simplex noise)', () => {
  it('stays within [-1, 1] and averages near zero', () => {
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    const points = samples(20_000, 40);
    for (const [x, y, z] of points) {
      const n = snoise3(x, y, z);
      sum += n;
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(1.2); // actually varies
    expect(Math.abs(sum / points.length)).toBeLessThan(0.05);
  });

  it('is continuous: a tiny step gives a tiny change', () => {
    for (const [x, y, z] of samples(500, 30)) {
      expect(Math.abs(snoise3(x + 1e-4, y, z) - snoise3(x, y, z))).toBeLessThan(5e-3);
    }
  });

  it('is deterministic', () => {
    expect(snoise3(1.234, -5.678, 9.1011)).toBe(snoise3(1.234, -5.678, 9.1011));
  });
});

describe('fbm and planet height', () => {
  it('keeps FBM within [-1, 1] in plain and ridged modes', () => {
    for (const ridged of [false, true]) {
      for (const [x, y, z] of samples(2000, 20)) {
        const h = fbm(x, y, z, 7, ridged);
        expect(h).toBeGreaterThanOrEqual(-1);
        expect(h).toBeLessThanOrEqual(1);
      }
    }
  });

  it('flattens everything below sea level to the sea level', () => {
    const ocean: HeightParams = { ...ARRAKIS, seaLevel: 0 };
    let flat = 0;
    for (const [x, y, z] of directions(2000)) {
      const h = normalisedHeight(x, y, z, ocean);
      expect(h).toBeGreaterThanOrEqual(0);
      if (h === 0) flat++;
    }
    expect(flat).toBeGreaterThan(200); // a real ocean, not a puddle
  });

  it('keeps the surface within radius * (1 +/- amplitude)', () => {
    for (const [x, y, z] of directions(2000)) {
      const r = surfaceRadius(x, y, z, 220, ARRAKIS);
      expect(r).toBeGreaterThanOrEqual(220 * (1 - ARRAKIS.amplitude));
      expect(r).toBeLessThanOrEqual(220 * (1 + ARRAKIS.amplitude));
    }
  });

  it('gives every seed its own, small offset (float32-safe)', () => {
    const a = seedOffset(7041);
    const b = seedOffset(2231);
    expect(a).not.toEqual(b);
    expect(seedOffset(7041)).toEqual(a);
    for (const v of [...a, ...b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(64);
    }
  });
});

describe('CPU/GPU parity', () => {
  // Reference heights read back from planetHeight.glsl on the GPU (Chrome on
  // the development Mac, rendered into a float texture) on 2026-11-21. The full browser
  // check over 4,096 directions per planet found a worst-case difference of
  // 1.2e-4 (normalised), i.e. under 0.002 world units of ground height.
  // If this test fails, the CPU port and the shader have drifted apart.
  const DIRECTIONS: Array<[number, number, number]> = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0.6, 0.8, 0],
    [-0.48, 0.6, -0.64],
  ];
  const GPU: Record<string, number[]> = {
    arrakis: [-0.21253, -0.073106, -0.27981, -0.344579, -0.442387],
    caladan: [0.240856, 0.427256, 0.05, 0.05, 0.05],
    'salusa-secundus': [-0.296182, 0.264964, 0.002777, 0.128068, 0.402426],
  };

  it('matches heights recorded from the GPU shader', async () => {
    const { loadSystemData } = await import('../data/systemData');
    const { Planet } = await import('../space/Planet');
    for (const body of loadSystemData().bodies) {
      if (body.type !== 'planet') continue;
      const expected = GPU[body.id];
      if (!expected) continue;
      const params = Planet.heightParamsFor(body);
      DIRECTIONS.forEach(([x, y, z], i) => {
        expect(Math.abs(normalisedHeight(x, y, z, params) - expected[i]!)).toBeLessThan(5e-4);
      });
    }
  });
});
