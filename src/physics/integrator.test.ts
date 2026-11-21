import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyDamping,
  clampLength,
  integrateOrientation,
  integratePosition,
  integrateVelocity,
  smoothingFactor,
} from './integrator';

const FIXED_DT = 1 / 120;

describe('velocity Verlet', () => {
  it('matches the closed-form solution under constant acceleration', () => {
    // x = x0 + v0 t + 1/2 a t^2 should hold exactly for constant a.
    const acceleration = new THREE.Vector3(0, -9.81, 2);
    let position = new THREE.Vector3(0, 100, 0);
    let velocity = new THREE.Vector3(5, 0, 0);
    const startPosition = position.clone();
    const startVelocity = velocity.clone();

    const steps = 240; // 2 seconds
    for (let i = 0; i < steps; i++) {
      position = integratePosition(position, velocity, acceleration, FIXED_DT);
      velocity = integrateVelocity(velocity, acceleration, acceleration, FIXED_DT);
    }

    const t = steps * FIXED_DT;
    const expected = startPosition
      .clone()
      .addScaledVector(startVelocity, t)
      .addScaledVector(acceleration, 0.5 * t * t);

    expect(position.distanceTo(expected)).toBeLessThan(1e-9);
    expect(velocity.distanceTo(startVelocity.clone().addScaledVector(acceleration, t))).toBeLessThan(1e-9);
  });

  it('leaves a body at rest with no acceleration at rest', () => {
    const position = integratePosition(
      new THREE.Vector3(3, 4, 5),
      new THREE.Vector3(),
      new THREE.Vector3(),
      FIXED_DT,
    );
    expect(position.toArray()).toEqual([3, 4, 5]);
  });
});

describe('applyDamping', () => {
  it('decays by e^(-k t) regardless of step size', () => {
    const coarse = new THREE.Vector3(10, 0, 0);
    const fine = new THREE.Vector3(10, 0, 0);
    for (let i = 0; i < 60; i++) applyDamping(coarse, 2, 1 / 60);
    for (let i = 0; i < 480; i++) applyDamping(fine, 2, 1 / 480);
    expect(coarse.x).toBeCloseTo(10 * Math.exp(-2), 10);
    expect(fine.x).toBeCloseTo(coarse.x, 10);
  });

  it('never reverses direction, even with an absurd coefficient', () => {
    const velocity = applyDamping(new THREE.Vector3(1, 0, 0), 10_000, FIXED_DT);
    expect(velocity.x).toBeGreaterThanOrEqual(0);
  });
});

describe('smoothingFactor', () => {
  it('converges to the same lag at any frame rate', () => {
    const target = 100;
    let at60 = 0;
    let at144 = 0;
    for (let i = 0; i < 60; i++) at60 += (target - at60) * smoothingFactor(5, 1 / 60);
    for (let i = 0; i < 144; i++) at144 += (target - at144) * smoothingFactor(5, 1 / 144);
    expect(at60).toBeCloseTo(at144, 2);
    expect(at60).toBeCloseTo(target * (1 - Math.exp(-5)), 1);
  });

  it('is zero for a non-positive lambda', () => {
    expect(smoothingFactor(0, FIXED_DT)).toBe(0);
    expect(smoothingFactor(-1, FIXED_DT)).toBe(0);
  });
});

describe('clampLength', () => {
  it('caps magnitude and keeps direction', () => {
    const vector = clampLength(new THREE.Vector3(30, 40, 0), 5);
    expect(vector.length()).toBeCloseTo(5, 12);
    expect(vector.x / vector.y).toBeCloseTo(30 / 40, 12);
  });

  it('leaves short vectors alone', () => {
    expect(clampLength(new THREE.Vector3(1, 0, 0), 5).length()).toBeCloseTo(1, 12);
  });
});

describe('integrateOrientation', () => {
  it('rotates by omega * dt about the body axis', () => {
    // A quarter turn about Y, integrated in 120 steps of 1/120 s.
    const omega = new THREE.Vector3(0, Math.PI / 2, 0);
    let orientation = new THREE.Quaternion();
    for (let i = 0; i < 120; i++) {
      orientation = integrateOrientation(orientation, omega, FIXED_DT);
    }
    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    expect(orientation.angleTo(expected)).toBeLessThan(1e-9);
  });

  it('stays normalised and unchanged with zero angular velocity', () => {
    const orientation = integrateOrientation(new THREE.Quaternion(0, 0, 0, 1), new THREE.Vector3(), FIXED_DT);
    expect(orientation.length()).toBeCloseTo(1, 12);
    expect(orientation.w).toBeCloseTo(1, 12);
  });
});
