import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  meanAnomaly,
  orbitalPosition,
  orbitalRadius,
  positionAtEccentricAnomaly,
  sampleOrbit,
  solveEccentricAnomaly,
  spinAngle,
  trueAnomaly,
  wrapAngle,
  type OrbitElements,
} from './kepler';

const ARRAKIS: OrbitElements = { a: 4200, e: 0.03, incDeg: 2, periodSec: 600, phase: 0.1 };
const SALUSA: OrbitElements = { a: 15500, e: 0.1, incDeg: 9, periodSec: 2100, phase: 5.5 };

describe('solveEccentricAnomaly', () => {
  it('satisfies Kepler\'s equation across mean anomalies and eccentricities', () => {
    for (const e of [0, 0.03, 0.1, 0.5, 0.9, 0.97]) {
      for (let k = -20; k <= 20; k++) {
        const m = (k / 20) * Math.PI * 0.999;
        const ecc = solveEccentricAnomaly(m, e);
        expect(ecc - e * Math.sin(ecc)).toBeCloseTo(m, 10);
      }
    }
  });

  it('returns E = M for a circular orbit', () => {
    expect(solveEccentricAnomaly(1.234, 0)).toBe(1.234);
  });

  it('rejects non-elliptical orbits', () => {
    expect(() => solveEccentricAnomaly(0, 1)).toThrow(RangeError);
    expect(() => solveEccentricAnomaly(0, -0.1)).toThrow(RangeError);
  });
});

describe('orbitalPosition', () => {
  it('repeats exactly after one period', () => {
    const a = orbitalPosition(SALUSA, 123.4);
    const b = orbitalPosition(SALUSA, 123.4 + SALUSA.periodSec);
    expect(a.distanceTo(b)).toBeLessThan(1e-6);
  });

  it('is at perihelion a(1-e) when M = 0 and aphelion a(1+e) when M = pi', () => {
    const elements = { ...SALUSA, phase: 0 };
    expect(orbitalPosition(elements, 0).length()).toBeCloseTo(elements.a * (1 - elements.e), 6);
    expect(orbitalPosition(elements, elements.periodSec / 2).length()).toBeCloseTo(elements.a * (1 + elements.e), 6);
  });

  it('agrees with the polar form r = a(1 - e cos E) at true anomaly v', () => {
    for (let i = 0; i < 16; i++) {
      const eccAnomaly = (i / 16) * Math.PI * 2;
      const point = positionAtEccentricAnomaly(SALUSA, eccAnomaly);
      const r = orbitalRadius(SALUSA.a, SALUSA.e, eccAnomaly);
      expect(point.length()).toBeCloseTo(r, 6);

      // Undo the inclination and read the in-plane angle (prograde about +Y).
      const inc = THREE.MathUtils.degToRad(SALUSA.incDeg);
      const zPlane = point.z * Math.cos(inc) - point.y * Math.sin(inc);
      const angle = Math.atan2(-zPlane, point.x);
      expect(wrapAngle(angle - trueAnomaly(eccAnomaly, SALUSA.e))).toBeCloseTo(0, 9);
    }
  });

  it('sweeps equal areas in equal times (Kepler\'s second law)', () => {
    // Area swept in a short interval is about 1/2 |r x dr|; it must be the same
    // near perihelion (fast) and near aphelion (slow).
    const elements = { ...SALUSA, phase: 0 };
    const dt = 0.01;
    const sweep = (t: number): number => {
      const p0 = orbitalPosition(elements, t);
      const p1 = orbitalPosition(elements, t + dt);
      return 0.5 * new THREE.Vector3().crossVectors(p0, p1).length();
    };
    const atPerihelion = sweep(0);
    const atAphelion = sweep(elements.periodSec / 2);
    expect(atPerihelion / atAphelion).toBeCloseTo(1, 6);
  });

  it('moves faster at perihelion than at aphelion', () => {
    const elements = { ...SALUSA, phase: 0 };
    const speed = (t: number): number => orbitalPosition(elements, t + 0.01).distanceTo(orbitalPosition(elements, t)) / 0.01;
    expect(speed(0)).toBeGreaterThan(speed(elements.periodSec / 2));
  });

  it('keeps an inclined orbit within r sin(i) of the reference plane', () => {
    const maxY = ARRAKIS.a * (1 + ARRAKIS.e) * Math.sin(THREE.MathUtils.degToRad(ARRAKIS.incDeg));
    let observedMax = 0;
    for (let t = 0; t < ARRAKIS.periodSec; t += 5) {
      observedMax = Math.max(observedMax, Math.abs(orbitalPosition(ARRAKIS, t).y));
    }
    expect(observedMax).toBeGreaterThan(0);
    expect(observedMax).toBeLessThanOrEqual(maxY + 1e-6);
  });

  it('orbits prograde: counter-clockwise seen from +Y', () => {
    const flat = { ...ARRAKIS, incDeg: 0, e: 0, phase: 0 };
    const p0 = orbitalPosition(flat, 0);
    const p1 = orbitalPosition(flat, 1);
    // (p0 x p1) points along +Y for a positive rotation about +Y.
    expect(new THREE.Vector3().crossVectors(p0, p1).y).toBeGreaterThan(0);
  });
});

describe('sampleOrbit', () => {
  it('puts every sample on the same ellipse the planet follows', () => {
    const samples = sampleOrbit(SALUSA, 64);
    expect(samples.length).toBe(64 * 3);
    // Every sample's distance from the star must be between perihelion and aphelion.
    for (let i = 0; i < 64; i++) {
      const r = Math.hypot(samples[i * 3]!, samples[i * 3 + 1]!, samples[i * 3 + 2]!);
      expect(r).toBeGreaterThanOrEqual(SALUSA.a * (1 - SALUSA.e) - 1e-6);
      expect(r).toBeLessThanOrEqual(SALUSA.a * (1 + SALUSA.e) + 1e-6);
    }
  });
});

describe('meanAnomaly and spinAngle', () => {
  it('advances mean anomaly linearly and wraps it', () => {
    const elements = { ...ARRAKIS, phase: 0 };
    expect(meanAnomaly(elements, elements.periodSec / 4)).toBeCloseTo(Math.PI / 2, 12);
    expect(meanAnomaly(elements, elements.periodSec)).toBeCloseTo(0, 9);
  });

  it('completes one spin per day length', () => {
    expect(spinAngle(90, 45)).toBeCloseTo(Math.PI, 12);
    expect(spinAngle(90, 90)).toBeCloseTo(0, 9);
  });
});
