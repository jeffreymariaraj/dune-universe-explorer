// Day 5. Unit V: physical modelling — force computation.
//
// Newtonian gravity on the ship from the star and from the planet whose
// SPHERE OF INFLUENCE it is inside (SYSTEM_DESIGN.md section 6):
//
//   a = G M / r^2, directed at the body       (inverse-square law)
//   r_SOI = a_orbit * (m / M)^(2/5)           (Laplace sphere of influence)
//
// Only the star plus at most one planet ever pull at once ("patched" gravity,
// as in most space games). Inside a body (r < radius) the pull falls off
// linearly to zero at the centre — the field of a uniform sphere — so there is
// no singularity if the ship ever ends up inside one.
//
// Pure functions: positions come in, accelerations go out. The ship's
// integrator and the trajectory predictor call exactly the same code.

import * as THREE from 'three';

/** A body that pulls, at one instant. */
export interface GravitySource {
  id: string;
  position: THREE.Vector3;
  /** Standard gravitational parameter mu = G M, world units^3 / s^2. */
  mu: number;
  /** Physical radius: inside it the field is that of a uniform sphere. */
  radius: number;
}

/**
 * Acceleration towards one source, added to `out`.
 *   outside (r >= R): mu / r^2
 *   inside  (r <  R): mu r / R^3   (continuous at r = R)
 */
export function addGravity(position: THREE.Vector3, source: GravitySource, out: THREE.Vector3): THREE.Vector3 {
  const dx = source.position.x - position.x;
  const dy = source.position.y - position.y;
  const dz = source.position.z - position.z;
  const r2 = dx * dx + dy * dy + dz * dz;
  if (r2 < 1e-12) return out;
  const r = Math.sqrt(r2);
  const magnitude = r >= source.radius ? source.mu / r2 : (source.mu * r) / source.radius ** 3;
  return out.set(out.x + (dx / r) * magnitude, out.y + (dy / r) * magnitude, out.z + (dz / r) * magnitude);
}

/** Laplace sphere-of-influence radius of a body of mass m orbiting mass M at distance a. */
export function sphereOfInfluence(semiMajorAxis: number, bodyMass: number, parentMass: number): number {
  return semiMajorAxis * (bodyMass / parentMass) ** 0.4;
}

/** Speed of a circular orbit of radius r around mu: v = sqrt(mu / r). Used by tests and tuning. */
export function circularSpeed(mu: number, r: number): number {
  return Math.sqrt(mu / r);
}

/** Escape speed at radius r: sqrt(2 mu / r). */
export function escapeSpeed(mu: number, r: number): number {
  return Math.sqrt((2 * mu) / r);
}

/** Specific orbital energy v^2/2 - mu/r: constant for an ideal two-body orbit. */
export function specificEnergy(position: THREE.Vector3, velocity: THREE.Vector3, centre: THREE.Vector3, mu: number): number {
  return velocity.lengthSq() / 2 - mu / position.distanceTo(centre);
}
