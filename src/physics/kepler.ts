// Day 2. Unit V: kinematics.
//
// On-rails orbits. For each body we have the elements a, e, incDeg, periodSec and
// phase from planets.json. Per fixed step:
//
//   M = 2*pi * (t / periodSec) + phase        (mean anomaly: grows linearly in time)
//   solve M = E - e sin E for E               (Kepler's equation, Newton's method)
//   x = a (cos E - e),  z = -b sin E          (b = a sqrt(1 - e^2), star at the focus)
//
// then rotate that point by the inclination about the +X axis (the line of
// nodes). The equivalent polar form is r = a (1 - e cos E) at true anomaly
//   v = 2 * atan2(sqrt(1+e) sin(E/2), sqrt(1-e) cos(E/2)),
// which the tests use to cross-check the Cartesian form.
//
// Orbits are prograde: counter-clockwise seen from +Y, i.e. a positive rotation
// about +Y, the same sense planets spin in. That is why z is -b sin E.
//
// Exact and stable for the whole demo, with no drift — which an n-body
// integrator could not promise. Pure functions with unit tests (CLAUDE.md).

import * as THREE from 'three';

/** Orbital elements exactly as they appear in planets.json (`orbit`). */
export interface OrbitElements {
  /** Semi-major axis, world units. */
  a: number;
  /** Eccentricity, 0 <= e < 1 (ellipses only). */
  e: number;
  /** Inclination of the orbital plane, degrees, about the +X axis. */
  incDeg: number;
  /** Time for one full orbit, seconds of simulation time. */
  periodSec: number;
  /** Mean anomaly at t = 0, radians. */
  phase: number;
}

const TWO_PI = Math.PI * 2;
const NEWTON_TOLERANCE = 1e-12;
const NEWTON_MAX_ITERATIONS = 12;

/** Wrap an angle into [-pi, pi). Newton converges fastest near zero. */
export function wrapAngle(angle: number): number {
  const wrapped = ((angle + Math.PI) % TWO_PI + TWO_PI) % TWO_PI;
  return wrapped - Math.PI;
}

/** M = 2 pi t / T + phase, wrapped to [-pi, pi). */
export function meanAnomaly(elements: OrbitElements, timeSec: number): number {
  return wrapAngle((TWO_PI * timeSec) / elements.periodSec + elements.phase);
}

/**
 * Solve Kepler's equation M = E - e sin E for the eccentric anomaly E.
 *
 * Newton's method on f(E) = E - e sin E - M, with f'(E) = 1 - e cos E:
 *   E <- E - f(E) / f'(E)
 * Starting from E = M (or pi for very eccentric orbits) it converges in 3-4
 * iterations for every orbit in planets.json (e <= 0.1).
 */
export function solveEccentricAnomaly(meanAnomalyRad: number, eccentricity: number): number {
  if (eccentricity < 0 || eccentricity >= 1) {
    throw new RangeError(`kepler: eccentricity ${eccentricity} is not an ellipse (0 <= e < 1)`);
  }
  const m = wrapAngle(meanAnomalyRad);
  if (eccentricity === 0) return m; // a circle: E = M exactly

  let e = eccentricity < 0.8 ? m : Math.PI * Math.sign(m || 1);
  for (let i = 0; i < NEWTON_MAX_ITERATIONS; i++) {
    const f = e - eccentricity * Math.sin(e) - m;
    const fPrime = 1 - eccentricity * Math.cos(e);
    const step = f / fPrime;
    e -= step;
    if (Math.abs(step) < NEWTON_TOLERANCE) break;
  }
  return e;
}

/** True anomaly v from eccentric anomaly E (the angle the star actually sees). */
export function trueAnomaly(eccentricAnomaly: number, eccentricity: number): number {
  const half = eccentricAnomaly / 2;
  return 2 * Math.atan2(Math.sqrt(1 + eccentricity) * Math.sin(half), Math.sqrt(1 - eccentricity) * Math.cos(half));
}

/** Distance from the focus (the star) at eccentric anomaly E. */
export function orbitalRadius(semiMajorAxis: number, eccentricity: number, eccentricAnomaly: number): number {
  return semiMajorAxis * (1 - eccentricity * Math.cos(eccentricAnomaly));
}

/**
 * Point on the orbit at eccentric anomaly E, relative to the parent body.
 * Shared by the planet's motion and its orbit line, so the planet can never
 * leave its own drawn path.
 */
export function positionAtEccentricAnomaly(
  elements: OrbitElements,
  eccentricAnomaly: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const { a, e } = elements;
  const b = a * Math.sqrt(1 - e * e);
  // In-plane coordinates with the star at the focus (origin).
  const x = a * (Math.cos(eccentricAnomaly) - e);
  const zPlane = -b * Math.sin(eccentricAnomaly);

  // Unit IV: a rotation about +X by the inclination tilts the orbital plane.
  //   y' =  y cos i - z sin i   (y = 0 in the plane)
  //   z' =  y sin i + z cos i
  const inc = THREE.MathUtils.degToRad(elements.incDeg);
  return out.set(x, -zPlane * Math.sin(inc), zPlane * Math.cos(inc));
}

/** Where the body is at simulation time t (seconds), relative to its parent. */
export function orbitalPosition(elements: OrbitElements, timeSec: number, out = new THREE.Vector3()): THREE.Vector3 {
  const eccentricAnomaly = solveEccentricAnomaly(meanAnomaly(elements, timeSec), elements.e);
  return positionAtEccentricAnomaly(elements, eccentricAnomaly, out);
}

/**
 * Sample the whole ellipse for an orbit line (Unit III: line primitives).
 * Sampled evenly in E rather than in time, which puts more points near
 * perihelion where the curve bends most.
 */
export function sampleOrbit(elements: OrbitElements, segments: number): Float32Array {
  const points = new Float32Array(segments * 3);
  const scratch = new THREE.Vector3();
  for (let i = 0; i < segments; i++) {
    positionAtEccentricAnomaly(elements, (i / segments) * TWO_PI, scratch);
    points[i * 3 + 0] = scratch.x;
    points[i * 3 + 1] = scratch.y;
    points[i * 3 + 2] = scratch.z;
  }
  return points;
}

/** Rotation angle (radians) of a body spinning once every dayLengthSec. */
export function spinAngle(dayLengthSec: number, timeSec: number): number {
  return ((TWO_PI * timeSec) / dayLengthSec) % TWO_PI;
}
