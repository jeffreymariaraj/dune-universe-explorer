import { describe, expect, it } from 'vitest';
import { fbm, seedOffset, type HeightParams } from './noise';
import { macroHeight, siteFrame, terrainHeight, terrainParamsFor, waterLevel } from './terrain';

const PLANET: HeightParams = {
  frequency: 1.4,
  octaves: 6,
  amplitude: 0.06,
  ridged: false,
  offset: seedOffset(7041),
  seaLevel: null,
};

const unit = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

describe('siteFrame', () => {
  it('is orthonormal and right-handed (east x up = south)', () => {
    for (const site of [unit(0.3, 0.8, -0.5), unit(0, 1, 0), unit(1, 0, 0), unit(-0.2, -0.9, 0.4)]) {
      const { east, north } = siteFrame(site);
      const dot = (a: number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
      expect(Math.hypot(...east)).toBeCloseTo(1, 12);
      expect(Math.hypot(...north)).toBeCloseTo(1, 12);
      expect(dot(east, north)).toBeCloseTo(0, 12);
      expect(dot(east, site)).toBeCloseTo(0, 12);
      expect(dot(north, site)).toBeCloseTo(0, 12);
    }
  });
});

describe('terrain heightfield', () => {
  const site = unit(0.3, 0.8, -0.5);
  const params = terrainParamsFor(PLANET, site, 7041, true);
  const frame = siteFrame(site);

  it('samples the planet orbit terrain exactly at the landing point', () => {
    const [ox, oy, oz] = PLANET.offset;
    const orbital = fbm(site[0] * 1.4 + ox, site[1] * 1.4 + oy, site[2] * 1.4 + oz, 6, false);
    expect(macroHeight(0, 0, params, frame)).toBeCloseTo(orbital, 12);
  });

  it('is deterministic and continuous', () => {
    expect(terrainHeight(12.5, -40, params, frame)).toBe(terrainHeight(12.5, -40, params, frame));
    for (let i = 0; i < 200; i++) {
      const x = (i * 37.1) % 900;
      const z = (i * 91.7) % 900;
      expect(Math.abs(terrainHeight(x + 0.01, z, params, frame) - terrainHeight(x, z, params, frame))).toBeLessThan(0.05);
    }
  });

  it('stays within relief + detail amplitude', () => {
    for (let i = 0; i < 500; i++) {
      const h = terrainHeight(i * 13.3 - 3000, i * 7.9 - 2000, params, frame);
      expect(Math.abs(h)).toBeLessThanOrEqual(params.relief + params.detail.amplitude + 1e-9);
    }
  });

  it('has a water plane only on worlds with a sea', () => {
    expect(waterLevel(params)).toBeNull();
    const wet = terrainParamsFor({ ...PLANET, seaLevel: 0.05 }, site, 1, false);
    expect(waterLevel(wet)).toBeCloseTo(0.05 * wet.relief, 12);
  });
});
