// Day 2. Unit V: kinematics, object hierarchies and transformation invariants.
// Unit III: line primitives (orbit ellipses as line loops).
//
// Builds the scene graph from src/data/planets.json: one orbit pivot per body,
// then a tilt node, then a spin node, then the mesh — so a planet's rotation can
// never leak into its orbital motion and vice versa.
//
//   SolarSystem.root
//    └─ star.frame (Canopus: photosphere, corona, light)
//        ├─ orbitLine (LineLoop, fixed in the star's frame)
//        └─ orbitPivot   translation only: Kepler position (physics/kepler.ts)
//            └─ tilt     fixed rotation about +Z by axialTiltDeg
//            │   └─ spin rotation about the tilted +Y, one turn per dayLengthSec
//            │       └─ Planet.lod (THREE.LOD: 3 cube-sphere levels)
//            └─ Planet.atmosphere (does not spin, so it sits on the pivot)
//
// Why three nodes and not one: the tilt is applied ABOVE the spin, so the spin
// axis is the tilted Y and keeps pointing the same way in space all year
// (that is what gives a planet seasons). And because the pivot only translates,
// a moon parented to it (not to `spin`) would orbit without being dragged
// round by the planet's day.
//
// Update/render split (CLAUDE.md): update() advances simulation time on the
// fixed step and stores previous + current pivot positions and spin angles;
// render() interpolates between them, like the ship does.
//
// The three cube-sphere LOD geometries are built once here and shared by all
// six planets (each planet scales them by its radius and displaces them in its
// own shader), so geometry memory does not grow with the number of planets.
//
// Planet generation and lore come only from planets.json (CLAUDE.md).

import * as THREE from 'three';
import type { BlackHoleData, BodyData, PlanetData, StarData, SystemData } from '../data/systemData';
import { sphereSphere, type Contact } from '../physics/collision';
import { addGravity, sphereOfInfluence, type GravitySource } from '../physics/gravity';
import { orbitalPosition, sampleOrbit, spinAngle, wrapAngle, type OrbitElements } from '../physics/kepler';
import { BlackHole } from './BlackHole';
import { buildCubeSphere } from './CubeSphere';
import { Planet } from './Planet';
import { Star } from './Star';

/** Segments per orbit line. 256 is smooth even for the outermost orbit. */
const ORBIT_SEGMENTS = 256;
/**
 * Quads per cube face edge for each LOD level, most detailed first:
 * 56 -> ~37.6k triangles, 24 -> ~6.9k, 10 -> 1.2k.
 */
const LOD_SEGMENTS = [56, 24, 10] as const;

/** One planet's nodes and kinematic state. */
export interface PlanetNode {
  readonly data: PlanetData;
  readonly planet: Planet;
  readonly orbitPivot: THREE.Group;
  readonly tilt: THREE.Group;
  readonly spin: THREE.Group;
  readonly orbitLine: THREE.LineLoop;
  // Fixed-step state, relative to the parent's frame.
  readonly position: THREE.Vector3;
  readonly prevPosition: THREE.Vector3;
  spinAngle: number;
  prevSpinAngle: number;
  /** Laplace sphere of influence about the star, world units. */
  readonly sphereOfInfluence: number;
}

/** A contact with a body of the system, plus that body's velocity this step. */
export interface BodyContact extends Contact {
  bodyId: string;
  bodyVelocity: THREE.Vector3;
}

/**
 * Gravitational constant G in game units (mu = G * mass from planets.json).
 * The surface scene uses it too, for g = G M / R^2 on foot.
 */
export const DEFAULT_GRAVITY_CONSTANT = 26_000;

/** The anomaly and its kinematic state (translation only: it does not spin). */
export interface AnomalyNode {
  readonly data: BlackHoleData;
  readonly blackHole: BlackHole;
  readonly orbitLine: THREE.LineLoop;
  readonly position: THREE.Vector3;
  readonly prevPosition: THREE.Vector3;
}

export interface SolarSystemTuning {
  /** Simulation seconds per real second. 1 is real time; raise it for the viva. */
  timeScale: number;
  /** Show the orbit ellipses (Day 10 moves this into the X-Ray panel). */
  showOrbits: boolean;
  /** Freeze orbits and spin without stopping the ship. */
  paused: boolean;
  /** Atmosphere shells on or off (viva: show what the shell adds). */
  showAtmospheres: boolean;
  /** Planet wireframes, to show the cube-sphere and the LOD switch. */
  wireframe: boolean;
  /**
   * Gravitational constant G (game units). mu = G * mass from planets.json.
   * 26,000 gives the star a pull of ~1.5 u/s^2 at Arrakis's orbit and ~72 u/s^2
   * at its surface; the ship's main engine gives 48 u/s^2.
   */
  gravityConstant: number;
}

/** Where the ship is relative to the system: for the HUD and the lore card. */
export interface NavigationFix {
  nearestId: string;
  nearestName: string;
  /** Distance to the nearest body's mean surface, world units. */
  altitude: number;
  /** Radius of that body. */
  nearestRadius: number;
  /** Planet whose sphere of influence the ship is in, or null (star only). */
  dominantId: string | null;
}

export class SolarSystem {
  readonly root = new THREE.Group();
  readonly star: Star;
  readonly planets: PlanetNode[] = [];
  /** Day 6: "The Silent Maw". Null if planets.json has no blackhole body. */
  anomaly: AnomalyNode | null = null;
  readonly tuning: SolarSystemTuning = {
    timeScale: 1,
    showOrbits: true,
    paused: false,
    showAtmospheres: true,
    wireframe: false,
    gravityConstant: DEFAULT_GRAVITY_CONSTANT,
  };

  /** Simulation time, seconds. Advanced only on the fixed step. */
  private time = 0;
  /** Simulation time at the start of the current step (gravity at 'start'). */
  private previousTime = 0;
  private readonly orbitMaterials: THREE.LineBasicMaterial[] = [];
  private readonly starWorld = new THREE.Vector3();
  private readonly planetWorld = new THREE.Vector3();
  private readonly lastCameraPosition = new THREE.Vector3();
  private readonly collisionScratch = new THREE.Vector3();
  private readonly hitScratch = new THREE.Vector3();
  private readonly gravitySource: GravitySource = { id: '', position: new THREE.Vector3(), mu: 0, radius: 1 };
  private readonly localScratch = new THREE.Vector3();
  private readonly tiltQuaternion = new THREE.Quaternion();
  private readonly spinQuaternion = new THREE.Quaternion();
  private readonly frameQuaternion = new THREE.Quaternion();
  private readonly lodGeometries: THREE.BufferGeometry[];

  /**
   * @param startTime Simulation time to start at, so returning from a surface
   *                  finds the planets where they were left (Day 7).
   */
  constructor(data: SystemData, startTime = 0) {
    this.time = startTime;
    this.previousTime = startTime;
    this.root.name = 'SolarSystem';

    const starData = data.bodies.find((b): b is StarData => b.type === 'star');
    if (!starData) throw new Error('SolarSystem: planets.json has no star');
    this.star = new Star(starData);
    this.root.add(this.star.frame);

    // Bounding sphere covering the tallest mountain on any planet (unit-sphere
    // units). The default radius-1 bound would let three.js frustum-cull a
    // planet whose displaced terrain is still on screen.
    const maxAmplitude = Math.max(
      0,
      ...data.bodies.map((b) => (b.type === 'planet' ? b.generation.noise.amplitude : 0)),
    );
    this.lodGeometries = LOD_SEGMENTS.map((segments) => {
      const geometry = buildCubeSphere(segments);
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1 + maxAmplitude * 1.05);
      return geometry;
    });

    for (const body of data.bodies) {
      if (body.type === 'planet') this.addPlanet(body);
      else if (body.type === 'blackhole') this.addAnomaly(body);
    }

    // Place everything at t = 0 so the first frame is already correct.
    this.computeState();
    for (const node of this.planets) {
      node.prevPosition.copy(node.position);
      node.prevSpinAngle = node.spinAngle;
    }
    this.anomaly?.prevPosition.copy(this.anomaly.position);
    this.applyInterpolated(1);
  }

  get simulationTime(): number {
    return this.time;
  }

  /** Fixed step: advance time, solve Kepler for every body. No rendering here. */
  update(dt: number): void {
    for (const node of this.planets) {
      node.prevPosition.copy(node.position);
      node.prevSpinAngle = node.spinAngle;
    }
    this.anomaly?.prevPosition.copy(this.anomaly.position);
    this.previousTime = this.time;
    if (!this.tuning.paused) this.time += dt * this.tuning.timeScale;
    this.computeState();
    this.star.setTime(this.time);
    this.anomaly?.blackHole.setTime(this.time);
  }

  /** Render frame: blend the previous and current step, update shader inputs. */
  applyInterpolated(alpha: number): void {
    for (const node of this.planets) {
      node.orbitPivot.position.lerpVectors(node.prevPosition, node.position, alpha);
      // Interpolate along the short way round, so a wrap from 2pi to 0 does not
      // spin the planet backwards for one frame.
      const delta = wrapAngle(node.spinAngle - node.prevSpinAngle);
      node.spin.rotation.y = node.prevSpinAngle + delta * alpha;
      node.orbitLine.visible = this.tuning.showOrbits;
      node.planet.atmosphere.visible = this.tuning.showAtmospheres;
      node.planet.wireframe = this.tuning.wireframe;
    }
    if (this.anomaly) {
      this.anomaly.blackHole.root.position.lerpVectors(this.anomaly.prevPosition, this.anomaly.position, alpha);
      this.anomaly.orbitLine.visible = this.tuning.showOrbits;
    }

    this.root.updateMatrixWorld();
    this.star.frame.getWorldPosition(this.starWorld);
    for (const node of this.planets) {
      node.orbitPivot.getWorldPosition(this.planetWorld);
      node.planet.updateLighting(this.planetWorld, this.starWorld);
    }
  }

  /**
   * Rotation from a planet's own frame (the one its terrain is defined in) to
   * world space at the current step: tilt, then spin. The inverse takes a
   * world direction onto the planet's map (landing sites, collision).
   */
  planetFrame(node: PlanetNode, out = new THREE.Quaternion()): THREE.Quaternion {
    this.tiltQuaternion.setFromAxisAngle(Z_AXIS, THREE.MathUtils.degToRad(node.data.physical.axialTiltDeg));
    this.spinQuaternion.setFromAxisAngle(Y_AXIS, node.spinAngle);
    return out.multiplyQuaternions(this.tiltQuaternion, this.spinQuaternion);
  }

  /** World-space position of a body's centre (as last rendered). */
  getWorldPosition(id: string, out = new THREE.Vector3()): THREE.Vector3 | null {
    if (id === this.star.data.id) return this.star.frame.getWorldPosition(out);
    if (this.anomaly && id === this.anomaly.data.id) return this.anomaly.blackHole.root.getWorldPosition(out);
    const node = this.planets.find((p) => p.data.id === id);
    return node ? node.orbitPivot.getWorldPosition(out) : null;
  }

  /**
   * Narrow phase against the star and every planet, on the fixed step, using
   * the CURRENT step's positions (not the interpolated render transforms).
   *
   * Planet ground height comes from the same noise function the shader uses:
   * the ship's offset from the planet is rotated back into the planet's own
   * frame (undo spin, then undo tilt) and looked up with surfaceRadiusAt().
   * Six planets do not need a broad phase; a cheap bounding-sphere reject
   * first is enough. The asteroid belt (2,000 rocks) is what needs the octree.
   */
  collideSphere(centre: THREE.Vector3, radius: number, dt: number, out: BodyContact[] = []): BodyContact[] {
    out.length = 0;

    const starContact = sphereSphere(centre, radius, ORIGIN, this.star.radius);
    if (starContact) out.push({ ...starContact, bodyId: this.star.data.id, bodyVelocity: new THREE.Vector3() });

    // The anomaly's photon sphere. SpaceScene treats this contact as fatal.
    if (this.anomaly) {
      const hole = this.anomaly.blackHole;
      const contact = sphereSphere(centre, radius, this.anomaly.position, hole.photonSphereRadius);
      if (contact) {
        out.push({
          ...contact,
          bodyId: this.anomaly.data.id,
          bodyVelocity: new THREE.Vector3().subVectors(this.anomaly.position, this.anomaly.prevPosition).divideScalar(dt),
        });
      }
    }

    for (const node of this.planets) {
      const offset = this.collisionScratch.subVectors(centre, node.position);
      const distance = offset.length();
      const peak = node.planet.radius * (1 + node.data.generation.noise.amplitude);
      if (distance >= peak + radius || distance < 1e-6) continue;

      // World offset -> planet frame: q = tilt * spin, so apply q^-1.
      this.planetFrame(node, this.frameQuaternion).invert();
      const localDirection = this.localScratch.copy(offset).applyQuaternion(this.frameQuaternion);
      const ground = node.planet.surfaceRadiusAt(localDirection);

      const depth = ground + radius - distance;
      if (depth <= 0) continue;
      const normal = offset.clone().divideScalar(distance);
      out.push({
        normal,
        depth,
        point: node.position.clone().addScaledVector(normal, ground),
        bodyId: node.data.id,
        // Finite difference of the on-rails orbit: the planet's velocity this step.
        bodyVelocity: new THREE.Vector3().subVectors(node.position, node.prevPosition).divideScalar(dt),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- gravity

  /** Simulation time at the start ('start') or end ('end') of the current step. */
  timeOf(when: 'start' | 'end'): number {
    return when === 'start' ? this.previousTime : this.time;
  }

  /** Simulation time `seconds` of ship time from now (time scale and pause applied). */
  futureTime(seconds: number): number {
    return this.tuning.paused ? this.time : this.time + seconds * this.tuning.timeScale;
  }

  /**
   * Gravity at a point at simulation time `time`: the star, plus the planet
   * whose Laplace sphere of influence contains the point (if any). Planet
   * positions are solved from their orbits for that exact time, so the same
   * call serves the ship's step and the trajectory prediction of the future.
   * Writes into `out`; returns the dominant planet's id, or null.
   */
  gravityAt(position: THREE.Vector3, time: number, out: THREE.Vector3): string | null {
    out.set(0, 0, 0);
    const G = this.tuning.gravityConstant;
    const star = this.star.data;
    this.gravitySource.id = star.id;
    this.gravitySource.position.set(0, 0, 0);
    this.gravitySource.mu = G * star.physical.mass;
    this.gravitySource.radius = star.physical.radius;
    addGravity(position, this.gravitySource, out);

    // The anomaly is as heavy as the star, so like the star it always pulls
    // (a sphere of influence only makes sense for a light body near a heavy one).
    if (this.anomaly) {
      const hole = this.anomaly.blackHole;
      this.gravitySource.id = this.anomaly.data.id;
      orbitalPosition(this.anomaly.data.orbit, time, this.gravitySource.position);
      this.gravitySource.mu = hole.mu;
      this.gravitySource.radius = hole.schwarzschildRadius;
      addGravity(position, this.gravitySource, out);
    }

    let dominant: string | null = null;
    for (const node of this.planets) {
      orbitalPosition(node.data.orbit, time, this.gravitySource.position);
      const distance = this.gravitySource.position.distanceTo(position);
      if (distance > node.sphereOfInfluence) continue;
      this.gravitySource.id = node.data.id;
      this.gravitySource.mu = G * node.data.physical.mass;
      this.gravitySource.radius = node.planet.radius;
      addGravity(position, this.gravitySource, out);
      dominant = node.data.id;
      break; // spheres of influence never overlap: orbits are far apart
    }
    return dominant;
  }

  /** Which body (if any) contains the point at time `time`; mean radius, for prediction. */
  bodyAt(position: THREE.Vector3, time: number): string | null {
    if (position.length() < this.star.radius) return this.star.data.id;
    if (this.anomaly) {
      orbitalPosition(this.anomaly.data.orbit, time, this.hitScratch);
      if (this.hitScratch.distanceTo(position) < this.anomaly.blackHole.photonSphereRadius) return this.anomaly.data.id;
    }
    for (const node of this.planets) {
      orbitalPosition(node.data.orbit, time, this.hitScratch);
      if (this.hitScratch.distanceTo(position) < node.planet.radius) return node.data.id;
    }
    return null;
  }

  /** Nearest body by distance to its surface, using the current step's positions. */
  navigationFix(position: THREE.Vector3): NavigationFix {
    let best: NavigationFix = {
      nearestId: this.star.data.id,
      nearestName: this.star.data.name,
      altitude: position.length() - this.star.radius,
      nearestRadius: this.star.radius,
      dominantId: null,
    };
    for (const node of this.planets) {
      const distance = node.position.distanceTo(position);
      const altitude = distance - node.planet.radius;
      if (altitude < best.altitude) {
        best = {
          nearestId: node.data.id,
          nearestName: node.data.name,
          altitude,
          nearestRadius: node.planet.radius,
          dominantId: null,
        };
      }
      if (distance <= node.sphereOfInfluence) best.dominantId = node.data.id;
    }
    if (this.anomaly) {
      // Its "size" for navigation is the visible disk, not the tiny horizon.
      const hole = this.anomaly.blackHole;
      const altitude = this.anomaly.position.distanceTo(position) - hole.diskOuter;
      if (altitude < best.altitude) {
        best = {
          nearestId: this.anomaly.data.id,
          nearestName: this.anomaly.data.name,
          altitude,
          nearestRadius: hole.diskOuter,
          dominantId: best.dominantId,
        };
      }
    }
    return best;
  }

  /** Debug readout: which LOD level the planet nearest the camera is drawing. */
  describeNearestLod(): string {
    let best: PlanetNode | null = null;
    let bestDistance = Infinity;
    for (const node of this.planets) {
      const distance = node.planet.lod.getWorldPosition(this.planetWorld).distanceTo(this.lastCameraPosition);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    if (!best) return '-';
    const radii = bestDistance / best.planet.radius;
    return `${best.data.name}: L${best.planet.currentLevel} @ ${radii.toFixed(1)} R`;
  }

  /** Remember the camera for describeNearestLod (render-time only). */
  setCameraPosition(position: THREE.Vector3): void {
    this.lastCameraPosition.copy(position);
  }

  /** Every body the HUD and Mentat can talk about, star first. */
  get bodies(): BodyData[] {
    const bodies: BodyData[] = [this.star.data, ...this.planets.map((p) => p.data)];
    if (this.anomaly) bodies.push(this.anomaly.data);
    return bodies;
  }

  dispose(): void {
    for (const node of this.planets) {
      node.planet.dispose();
      node.orbitLine.geometry.dispose();
    }
    for (const material of this.orbitMaterials) material.dispose();
    for (const geometry of this.lodGeometries) geometry.dispose();
    this.lodGeometries.length = 0;
    this.orbitMaterials.length = 0;
    this.planets.length = 0;
    if (this.anomaly) {
      this.anomaly.blackHole.dispose();
      this.anomaly.orbitLine.geometry.dispose();
      this.anomaly = null;
    }
    this.star.dispose();
    this.root.removeFromParent();
    this.root.clear();
  }

  // ------------------------------------------------------------------ building

  private addAnomaly(data: BlackHoleData): void {
    if (this.anomaly) {
      console.warn(`SolarSystem: only one anomaly is supported; ${data.id} skipped`);
      return;
    }
    const blackHole = new BlackHole(data);
    this.star.frame.add(blackHole.root);
    const orbitLine = this.buildOrbitLine(data.orbit, '#9b7cff', data.name);
    this.star.frame.add(orbitLine);
    this.anomaly = { data, blackHole, orbitLine, position: new THREE.Vector3(), prevPosition: new THREE.Vector3() };
  }

  private addPlanet(data: PlanetData): void {
    if (data.parent !== this.star.data.id) {
      // Moons would parent to their planet's orbitPivot; none exist yet.
      console.warn(`SolarSystem: ${data.id} orbits "${data.parent}", which is not the star; skipped`);
      return;
    }

    const planet = new Planet(data, this.lodGeometries, this.star.color);

    const orbitPivot = new THREE.Group();
    orbitPivot.name = `${data.name}:orbitPivot`;
    const tilt = new THREE.Group();
    tilt.name = `${data.name}:tilt`;
    tilt.rotation.z = THREE.MathUtils.degToRad(data.physical.axialTiltDeg);
    const spin = new THREE.Group();
    spin.name = `${data.name}:spin`;

    orbitPivot.add(tilt);
    tilt.add(spin);
    spin.add(planet.lod);
    orbitPivot.add(planet.atmosphere.mesh);
    this.star.frame.add(orbitPivot);

    const orbitLine = this.buildOrbitLine(data.orbit, data.generation.atmosphere.color, data.name);
    this.star.frame.add(orbitLine);

    this.planets.push({
      data,
      planet,
      orbitPivot,
      tilt,
      spin,
      orbitLine,
      position: new THREE.Vector3(),
      prevPosition: new THREE.Vector3(),
      spinAngle: 0,
      prevSpinAngle: 0,
      sphereOfInfluence: sphereOfInfluence(data.orbit.a, data.physical.mass, this.star.data.physical.mass),
    });
  }

  /** The ellipse the planet follows, from the same Kepler maths. */
  private buildOrbitLine(orbit: OrbitElements, color: THREE.ColorRepresentation, name: string): THREE.LineLoop {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(sampleOrbit(orbit, ORBIT_SEGMENTS), 3));
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    this.orbitMaterials.push(material);
    const line = new THREE.LineLoop(geometry, material);
    line.name = `${name}:orbit`;
    return line;
  }

  private computeState(): void {
    for (const node of this.planets) {
      orbitalPosition(node.data.orbit, this.time, node.position);
      node.spinAngle = spinAngle(node.data.physical.dayLengthSec, this.time);
    }
    if (this.anomaly) orbitalPosition(this.anomaly.data.orbit, this.time, this.anomaly.position);
  }
}

const ORIGIN = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
