// Day 9. Unit IV: frames and rotations; Unit V: kinematics.
//
// Pure helpers for the planet's own frame (where its terrain is defined), so a
// landing site can be chosen from planets.json and a simulation time alone —
// without the space scene being loaded. The Mentat uses this to teleport the
// pilot straight to a landmark, even from another planet's surface.
//
//   world = position + R_tilt * R_spin(t) * local       (SolarSystem's hierarchy)
//   local = (R_tilt * R_spin(t))^-1 * (world - position)

import * as THREE from 'three';
import type { PlanetData } from '../data/systemData';
import { orbitalPosition, spinAngle } from '../physics/kepler';
import type { LandingSite } from '../surface/SurfaceScene';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** Rotation from the planet's own frame to world space at simulation time t. */
export function planetFrameAt(planet: PlanetData, time: number, out = new THREE.Quaternion()): THREE.Quaternion {
  const tilt = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, THREE.MathUtils.degToRad(planet.physical.axialTiltDeg));
  const spin = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, spinAngle(planet.physical.dayLengthSec, time));
  return out.multiplyQuaternions(tilt, spin);
}

/**
 * A daytime landing site: the point under the star (the subsolar point), moved
 * 0.6 rad along the planet's spin so the sun stands at a mid-morning angle
 * rather than straight overhead. The star sits at the world origin.
 */
export function daysideLandingSite(planet: PlanetData, time: number, poiId?: string): LandingSite {
  const toPlanetFrame = planetFrameAt(planet, time).invert();
  const position = orbitalPosition(planet.orbit, time);
  const sun = position.clone().negate().normalize().applyQuaternion(toPlanetFrame);
  const site = sun.clone().applyAxisAngle(Y_AXIS, -0.6).normalize();
  const landing: LandingSite = {
    planetId: planet.id,
    site: [site.x, site.y, site.z],
    sun: [sun.x, sun.y, sun.z],
    time,
  };
  if (poiId) landing.poiId = poiId;
  return landing;
}
