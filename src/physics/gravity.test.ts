import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { addGravity, circularSpeed, escapeSpeed, specificEnergy, sphereOfInfluence, type GravitySource } from './gravity';
import { verletStep } from './integrator';
import { predictTrajectory, type TrajectoryEnvironment } from './trajectory';

const STAR: GravitySource = { id: 'star', position: new THREE.Vector3(), mu: 26_000_000, radius: 600 };

const pull = (position: THREE.Vector3, source = STAR): THREE.Vector3 =>
  addGravity(position, source, new THREE.Vector3());

describe('addGravity', () => {
  it('follows the inverse-square law and points at the body', () => {
    const near = pull(new THREE.Vector3(1000, 0, 0));
    const far = pull(new THREE.Vector3(2000, 0, 0));
    expect(near.x).toBeLessThan(0);
    expect(near.length() / far.length()).toBeCloseTo(4, 10);
    expect(near.length()).toBeCloseTo(STAR.mu / 1000 ** 2, 8);
  });

  it('is continuous at the surface and zero at the centre', () => {
    const outside = pull(new THREE.Vector3(600.0001, 0, 0)).length();
    const inside = pull(new THREE.Vector3(599.9999, 0, 0)).length();
    expect(inside / outside).toBeCloseTo(1, 5);
    expect(pull(new THREE.Vector3(300, 0, 0)).length()).toBeCloseTo(outside / 2, 3);
    expect(pull(new THREE.Vector3(0, 0, 0)).length()).toBe(0);
  });

  it('adds to what is already in out', () => {
    const out = new THREE.Vector3(1, 2, 3);
    addGravity(new THREE.Vector3(0, 1000, 0), STAR, out);
    expect(out.x).toBe(1);
    expect(out.y).toBeLessThan(2);
  });
});

describe('sphereOfInfluence and orbital speeds', () => {
  it('matches the Laplace formula', () => {
    expect(sphereOfInfluence(4200, 1, 1000)).toBeCloseTo(4200 * 0.001 ** 0.4, 9);
  });

  it('relates escape speed to circular speed by sqrt(2)', () => {
    expect(escapeSpeed(STAR.mu, 5000) / circularSpeed(STAR.mu, 5000)).toBeCloseTo(Math.SQRT2, 12);
  });
});

describe('velocity Verlet under gravity', () => {
  const field = (p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 => addGravity(p, STAR, out.set(0, 0, 0));

  it('keeps a circular orbit circular and conserves energy over 5 orbits', () => {
    const r = 4200;
    const position = new THREE.Vector3(r, 0, 0);
    const velocity = new THREE.Vector3(0, 0, -circularSpeed(STAR.mu, r));
    const acceleration = field(position, new THREE.Vector3());
    const e0 = specificEnergy(position, velocity, STAR.position, STAR.mu);
    const period = (2 * Math.PI * r) / velocity.length();
    const dt = 1 / 120;
    let minR = Infinity;
    let maxR = 0;
    for (let i = 0; i < (5 * period) / dt; i++) {
      verletStep(position, velocity, acceleration, field, dt);
      minR = Math.min(minR, position.length());
      maxR = Math.max(maxR, position.length());
    }
    const e1 = specificEnergy(position, velocity, STAR.position, STAR.mu);
    expect(Math.abs((e1 - e0) / e0)).toBeLessThan(1e-6);
    expect((maxR - minR) / r).toBeLessThan(1e-4);
  });

  it('beats explicit Euler, which gains energy and spirals out', () => {
    const r = 4200;
    const dt = 1 / 20; // coarse step, like the trajectory predictor
    const steps = 4000;
    const runVerlet = (): number => {
      const p = new THREE.Vector3(r, 0, 0);
      const v = new THREE.Vector3(0, 0, -circularSpeed(STAR.mu, r));
      const a = field(p, new THREE.Vector3());
      for (let i = 0; i < steps; i++) verletStep(p, v, a, field, dt);
      return Math.abs(p.length() - r);
    };
    const runEuler = (): number => {
      const p = new THREE.Vector3(r, 0, 0);
      const v = new THREE.Vector3(0, 0, -circularSpeed(STAR.mu, r));
      const a = new THREE.Vector3();
      for (let i = 0; i < steps; i++) {
        field(p, a);
        p.addScaledVector(v, dt);
        v.addScaledVector(a, dt);
      }
      return Math.abs(p.length() - r);
    };
    expect(runVerlet() * 50).toBeLessThan(runEuler());
  });
});

describe('predictTrajectory', () => {
  const empty: TrajectoryEnvironment = {
    gravityAt: (_p, _t, out) => out.set(0, 0, 0),
    hitAt: () => null,
  };

  it('is a straight line with no gravity and no damping', () => {
    const out = new Float32Array(11 * 3);
    const result = predictTrajectory(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), empty, 10, 0.5, 0, out);
    expect(result.count).toBe(11);
    expect(out[10 * 3]).toBeCloseTo(50, 5);
    expect(out[10 * 3 + 1]).toBe(0);
  });

  it('stops at the first point inside a body and names it', () => {
    const environment: TrajectoryEnvironment = {
      gravityAt: (p, _t, out) => addGravity(p, STAR, out.set(0, 0, 0)),
      hitAt: (p) => (p.length() < STAR.radius ? 'star' : null),
    };
    const out = new Float32Array(601 * 3);
    const result = predictTrajectory(new THREE.Vector3(1500, 0, 0), new THREE.Vector3(), environment, 600, 1 / 20, 0, out);
    expect(result.impactBodyId).toBe('star');
    expect(result.count).toBeLessThan(601);
  });

  it('follows exactly the same path as stepping the ship by hand', () => {
    const field = (p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 => addGravity(p, STAR, out.set(0, 0, 0));
    const environment: TrajectoryEnvironment = { gravityAt: (p, _t, out) => field(p, out), hitAt: () => null };
    const start = new THREE.Vector3(5000, 100, 0);
    const startVelocity = new THREE.Vector3(0, 0, -60);
    const out = new Float32Array(121 * 3);
    predictTrajectory(start, startVelocity, environment, 120, 1 / 120, 0, out);

    const p = start.clone();
    const v = startVelocity.clone();
    const a = field(p, new THREE.Vector3());
    for (let i = 0; i < 120; i++) verletStep(p, v, a, field, 1 / 120);
    expect(out[120 * 3]).toBeCloseTo(p.x, 2);
    expect(out[120 * 3 + 2]).toBeCloseTo(p.z, 2);
  });
});
