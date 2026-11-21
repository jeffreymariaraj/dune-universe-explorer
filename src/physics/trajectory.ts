// Day 5. Unit V: physical modelling. Unit III: line primitives (the result is
// drawn as a polyline by ship/TrajectoryLine.ts).
//
// Predicted trajectory: integrate a COPY of the ship's state forward with the
// same velocity-Verlet step and the same gravity as the real ship, engines off,
// and record where it goes (SYSTEM_DESIGN.md section 6: "integrating 600 steps
// ahead"). Planets keep moving along their rails during the prediction, so a
// close pass is predicted against where the planet WILL be, not where it is.
//
// Stops early if the path enters a body, so the line ends at the impact point.

import * as THREE from 'three';
import { applyDamping, verletStep } from './integrator';

export interface TrajectoryEnvironment {
  /** Gravity at a position, `seconds` into the future. */
  gravityAt(position: THREE.Vector3, seconds: number, out: THREE.Vector3): THREE.Vector3;
  /** Id of the body the point is inside, `seconds` into the future, or null. */
  hitAt(position: THREE.Vector3, seconds: number): string | null;
}

export interface TrajectoryResult {
  /** Number of points written to `out` (the first is the start position). */
  count: number;
  /** Body the path runs into, if any. */
  impactBodyId: string | null;
}

/**
 * Integrate `steps` steps of `dt` seconds from (position, velocity) and write
 * the points into `out` (x, y, z triples; needs room for steps + 1 points).
 * `damping` is the ship's always-on drag, 1/s, applied exactly as in flight.
 */
export function predictTrajectory(
  start: THREE.Vector3,
  startVelocity: THREE.Vector3,
  environment: TrajectoryEnvironment,
  steps: number,
  dt: number,
  damping: number,
  out: Float32Array,
): TrajectoryResult {
  const position = start.clone();
  const velocity = startVelocity.clone();
  const acceleration = new THREE.Vector3();
  let seconds = 0;
  environment.gravityAt(position, seconds, acceleration);

  const field = (p: THREE.Vector3, a: THREE.Vector3): THREE.Vector3 => environment.gravityAt(p, seconds, a.set(0, 0, 0));

  out[0] = position.x;
  out[1] = position.y;
  out[2] = position.z;
  let count = 1;

  for (let i = 0; i < steps; i++) {
    seconds += dt; // the field is evaluated at the END of the step
    verletStep(position, velocity, acceleration, field, dt);
    applyDamping(velocity, damping, dt);

    out[count * 3 + 0] = position.x;
    out[count * 3 + 1] = position.y;
    out[count * 3 + 2] = position.z;
    count++;

    const hit = environment.hitAt(position, seconds);
    if (hit) return { count, impactBodyId: hit };
  }
  return { count, impactBodyId: null };
}
