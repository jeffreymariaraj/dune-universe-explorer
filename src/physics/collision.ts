// Day 4 (used again on Days 7-8). Unit V: collision detection and response.
//
// Narrow phase, all as pure functions so they can be unit tested:
//   * sphere vs sphere      — ship vs asteroid, ship vs planet
//   * ray vs sphere         — picking the landing target (Day 7)
//   * contact response      — push out of the overlap, then bounce
// The heightfield query lives in physics/noise.ts (surfaceRadius), so terrain
// collision uses the exact function the planet shader displaces with.
//
// Response maths (impulse with restitution e, on the RELATIVE velocity, so a
// moving planet hits you as hard as you hit it):
//   v_rel = v - v_other,  vn = v_rel . n         (n points from the other body to us)
//   if vn < 0:  v_rel <- v_rel - (1 + e) vn n     (reflect the normal part, scaled)
//               tangential part *= (1 - friction)
//   v = v_rel + v_other
// The ship is treated as infinitely lighter than what it hits (asteroids and
// planets do not move), which is why only the ship's velocity changes.

import * as THREE from 'three';

export interface Contact {
  /** Unit normal pointing from the other body towards the first one. */
  normal: THREE.Vector3;
  /** Overlap depth, world units (> 0 when touching). */
  depth: number;
  /** Contact point on the other body's surface. */
  point: THREE.Vector3;
}

/**
 * Sphere vs sphere. Returns null when they do not touch.
 * Overlap when |a - b| < ra + rb, compared squared to avoid the sqrt on misses.
 */
export function sphereSphere(
  aCentre: THREE.Vector3,
  aRadius: number,
  bCentre: THREE.Vector3,
  bRadius: number,
): Contact | null {
  const reach = aRadius + bRadius;
  const delta = new THREE.Vector3().subVectors(aCentre, bCentre);
  const distanceSq = delta.lengthSq();
  if (distanceSq >= reach * reach) return null;

  const distance = Math.sqrt(distanceSq);
  // Exactly concentric: any direction is as good as another; pick +Y.
  const normal = distance > 1e-9 ? delta.divideScalar(distance) : new THREE.Vector3(0, 1, 0);
  return {
    normal,
    depth: reach - distance,
    point: bCentre.clone().addScaledVector(normal, bRadius),
  };
}

/**
 * Ray vs sphere: the smallest t >= 0 with |origin + t dir - centre| = radius,
 * or null on a miss. `direction` must be unit length. Solves the quadratic
 *   t^2 + 2 b t + c = 0,  b = (o - c).d,  c = |o - c|^2 - r^2
 * If the origin is inside the sphere, the exit point is returned.
 */
export function raySphere(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  centre: THREE.Vector3,
  radius: number,
): number | null {
  const ox = origin.x - centre.x;
  const oy = origin.y - centre.y;
  const oz = origin.z - centre.z;
  const b = ox * direction.x + oy * direction.y + oz * direction.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c > 0 && b > 0) return null; // outside and pointing away
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const t = -b - root;
  return t >= 0 ? t : -b + root;
}

export interface ResponseResult {
  /** Speed into the surface before the bounce (>= 0). Drives damage and shake. */
  impactSpeed: number;
}

/**
 * Resolve a contact in place: move `position` out along the normal by the
 * overlap, then bounce `velocity` off the surface relative to `otherVelocity`.
 */
export function resolveContact(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  contact: Contact,
  restitution: number,
  friction: number,
  otherVelocity: THREE.Vector3 = ZERO,
): ResponseResult {
  // Positional correction: never leave the ship inside a rock.
  position.addScaledVector(contact.normal, contact.depth);

  const relative = new THREE.Vector3().subVectors(velocity, otherVelocity);
  const normalSpeed = relative.dot(contact.normal);
  if (normalSpeed >= 0) return { impactSpeed: 0 }; // already separating

  const normalPart = contact.normal.clone().multiplyScalar(normalSpeed);
  const tangentPart = relative.sub(normalPart);
  tangentPart.multiplyScalar(1 - THREE.MathUtils.clamp(friction, 0, 1));
  normalPart.multiplyScalar(-THREE.MathUtils.clamp(restitution, 0, 1));

  velocity.copy(otherVelocity).add(tangentPart).add(normalPart);
  return { impactSpeed: -normalSpeed };
}

/** Hull damage for an impact: nothing below a scrape threshold, then linear. */
export function impactDamage(impactSpeed: number, threshold: number, perUnitSpeed: number): number {
  return Math.max(0, impactSpeed - threshold) * perUnitSpeed;
}

const ZERO = new THREE.Vector3();
