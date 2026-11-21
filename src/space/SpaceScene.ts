// Unit IV: viewing pipeline. Unit V: object hierarchies and kinematics.
//
// The free-flight state: skybox, the solar system from planets.json (star +
// planets on Kepler orbits, Day 2), the asteroid belt and ship collisions plus
// the engine trail (Day 4), ship, chase camera, and the black hole drawn
// through PostFX (lensing, bloom, tone mapping; Day 6).
//
// Collision (Unit V), once per fixed step, after the ship has moved:
//   broad phase  : octree query against the belt; bounding-sphere reject for
//                  the six planets and the star
//   narrow phase : sphere vs sphere (asteroids, star) and sphere vs noise
//                  heightfield (planets)
//   response     : push out, bounce on the relative velocity, hull damage, and
//                  a 'ship:collision' event that the camera turns into shake
//
// Day 10: the X-Ray panel (X) and the orthographic system map (O).
//
// Day 5: gravity from the solar system is injected into the ship controller;
// a predicted trajectory is integrated 30 s ahead several times a second; and a
// 10 Hz 'nav:update' feeds the HUD, radar and lore card over the EventBus.
//
// Day 7: landing. A ray from the ship along its nose (the reticle) is tested
// against every planet with ray-vs-sphere; the nearest hit within range is the
// landing target. Pressing L converts the hit point into the planet's own frame
// (undo spin and tilt) and asks for Warp -> Surface with that site. Coming back
// up, enter() receives the same site and puts the ship above it, at the
// simulation time it left, facing away from the ground.
//
// Update/render split (CLAUDE.md): update() is the fixed 1/120 s step and does
// all simulation; render() only interpolates transforms and draws.

import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import type { EventBus } from '../core/EventBus';
import type { InputManager } from '../core/InputManager';
import type { GameState } from '../core/StateMachine';
import { impactDamage, raySphere, resolveContact } from '../physics/collision';
import type { LandingSite, WarpPayload } from '../surface/SurfaceScene';
import { daysideLandingSite } from './landing';
import { CameraRig } from '../ship/CameraRig';
import { EngineTrail } from '../ship/EngineTrail';
import { TrajectoryLine } from '../ship/TrajectoryLine';
import { PostFX } from '../render/PostFX';
import { XRay } from '../render/XRay';
import { SystemMap } from './SystemMap';
import { predictTrajectory, type TrajectoryEnvironment } from '../physics/trajectory';
import { Ship } from '../ship/Ship';
import { ShipController } from '../ship/ShipController';
import { loadSystemData } from '../data/systemData';
import { AsteroidField, type AsteroidContact } from './AsteroidField';
import { Skybox } from './Skybox';
import { SolarSystem, type BodyContact } from './SolarSystem';

/** Where the ship appears at load: this planet, seen from its day side. */
const SPAWN_BODY = 'arrakis';
/** "Jump to" id for the asteroid belt (not a planets.json body). */
export const BELT_ID = 'asteroid-belt';

/** Trajectory prediction: 600 steps of 1/20 s = 30 s ahead (SYSTEM_DESIGN.md 6). */
const PREDICTION_STEPS = 600;
const PREDICTION_DT = 1 / 20;
/** Re-predict every 6 fixed steps (20 Hz); publish navigation every 12 (10 Hz). */
const PREDICT_EVERY_N_STEPS = 6;
const NAV_EVERY_N_STEPS = 12;
/** Landing range: the reticle ray must hit a planet within this many radii. */
const LANDING_RANGE_RADII = 8;

export interface ImpactTuning {
  /** Bounciness, 0 (dead stop) .. 1 (perfect bounce). */
  restitution: number;
  /** Fraction of sliding speed lost per impact. */
  friction: number;
  /** Impacts slower than this are scrapes: no damage. */
  damageThreshold: number;
  /** Hull points per unit of impact speed above the threshold. */
  damagePerSpeed: number;
  /** Impact speed that gives full camera trauma. */
  traumaSpeed: number;
}

export const DEFAULT_IMPACT: ImpactTuning = {
  restitution: 0.45,
  friction: 0.2,
  damageThreshold: 8,
  damagePerSpeed: 0.35,
  traumaSpeed: 90,
};

export class SpaceScene implements GameState {
  readonly name = 'Space' as const;

  readonly scene = new THREE.Scene();
  readonly ship = new Ship();
  readonly skybox: Skybox;
  controller!: ShipController;
  rig!: CameraRig;
  solarSystem!: SolarSystem;
  asteroids!: AsteroidField;
  trail!: EngineTrail;
  trajectory!: TrajectoryLine;
  postFX!: PostFX;
  xray!: XRay;
  map!: SystemMap;
  /** Day 10: drawing through the orthographic map camera instead of the chase camera. */
  mapMode = false;
  readonly impact: ImpactTuning = { ...DEFAULT_IMPACT };

  /** Advanced by the fixed step, so shader animation is deterministic. */
  private elapsed = 0;
  private fillLight: THREE.HemisphereLight | null = null;
  private loaded = false;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly asteroidContacts: AsteroidContact[] = [];
  private readonly bodyContacts: BodyContact[] = [];
  private readonly nozzle = new THREE.Vector3();
  private readonly backward = new THREE.Vector3();
  private pendingRespawn = false;
  /** Simulation time when we left for the surface; the system resumes from it. */
  private savedTime = 0;
  private stepCount = 0;
  private impactBodyId: string | null = null;
  private readonly predictionEnvironment: TrajectoryEnvironment = {
    gravityAt: (position, seconds, out) => {
      this.solarSystem.gravityAt(position, this.solarSystem.futureTime(seconds), out);
      return out;
    },
    hitAt: (position, seconds) => this.solarSystem.bodyAt(position, this.solarSystem.futureTime(seconds)),
  };
  private readonly forwardScratch = new THREE.Vector3();
  private readonly relativeScratch = new THREE.Vector3();

  constructor(
    private readonly assets: AssetLoader,
    private readonly input: InputManager,
    private readonly bus: EventBus,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.scene.name = 'SpaceScene';
    this.skybox = new Skybox(this.assets);
  }

  get camera(): THREE.PerspectiveCamera {
    return this.rig.camera;
  }

  async enter(payload?: unknown): Promise<void> {
    const entry = payload as { returnFrom?: LandingSite; destination?: string } | undefined;
    const returnFrom = entry?.returnFrom ?? null;
    const destination = entry?.destination ?? null;
    const size = this.renderer.getSize(new THREE.Vector2());
    const aspect = size.x / Math.max(size.y, 1);

    await this.skybox.load(this.scene, this.renderer.getPixelRatio());

    await this.ship.load(this.assets);
    this.scene.add(this.ship.root);

    this.rig = new CameraRig(this.ship, aspect);
    this.controller = new ShipController(this.ship, this.input, this.bus);

    // Unit V: the whole system hierarchy is built from planets.json.
    const systemData = loadSystemData();
    this.solarSystem = new SolarSystem(systemData, this.savedTime);
    this.scene.add(this.solarSystem.root);

    // Unit I: 2,000 rocks, one draw call.
    this.asteroids = new AsteroidField(systemData.system.asteroidBelt);
    this.scene.add(this.asteroids.root);

    // Unit V: gravity reaches the ship only through this function.
    this.controller.gravity = (position, when, out) => {
      this.solarSystem.gravityAt(position, this.solarSystem.timeOf(when), out);
      return out;
    };

    // Day 6: every frame now goes through the post-processing chain.
    this.postFX = new PostFX(this.renderer, this.scene, this.rig.camera);
    this.postFX.setSize(size.x, size.y);

    // Day 10: orthographic system map (O) and the X-Ray panel (X).
    this.map = new SystemMap(
      this.solarSystem.bodies.map((body) => ({
        id: body.id,
        name: body.name,
        radius: 'radius' in body.physical ? body.physical.radius : body.physical.diskOuter,
        color:
          body.type === 'planet' ? body.generation.atmosphere.color : body.type === 'star' ? body.physical.color : '#9b7cff',
      })),
    );
    this.map.resize(size.x, size.y);
    this.scene.add(this.map.root);
    this.mapMode = false;
    this.xray = new XRay(document.getElementById('overlay') ?? document.body, this.bus, {
      scene: this.scene,
      camera: this.rig.camera,
      postFX: this.postFX,
      normalsMesh: () => {
        let found: THREE.Mesh | null = null;
        this.ship.root.traverse((child) => {
          if (!found && child instanceof THREE.Mesh) found = child;
        });
        return found;
      },
      boundingSpheres: (out) => this.collectBoundingSpheres(out),
      octree: { tree: this.asteroids.octree, frame: this.asteroids.root },
      setPaths: (visible) => {
        this.solarSystem.tuning.showOrbits = visible;
        this.trajectory.visible = visible;
        if (!visible) this.trajectory.clear();
      },
      setWireframe: (on) => {
        this.solarSystem.tuning.wireframe = on;
      },
      matrix: () => ({ label: 'Ship model matrix (world)', matrix: this.ship.root.matrixWorld }),
      stateName: () => (this.mapMode ? 'Space (orthographic map)' : 'Space'),
    });

    this.trajectory = new TrajectoryLine(PREDICTION_STEPS);
    this.scene.add(this.trajectory.line);

    this.trail = new EngineTrail();
    this.trail.setViewportHeight(size.y * this.renderer.getPixelRatio());
    this.scene.add(this.trail.points);

    // Event-driven reactions (Unit II): systems hear about impacts on the bus.
    this.unsubscribers.push(
      this.bus.on('ship:collision', ({ impactSpeed }) => {
        this.rig.addTrauma(Math.min(1, impactSpeed / this.impact.traumaSpeed) + 0.15);
      }),
      this.bus.on('ship:destroyed', () => {
        this.pendingRespawn = true;
      }),
      this.bus.on('input:trigger', ({ action }) => {
        if (action === 'land' && this.loaded) this.tryLand();
      }),
      this.bus.on('mentat:teleport', ({ bodyId, poiId }) => {
        if (this.loaded) this.mentatTeleport(bodyId, poiId);
      }),
      this.bus.on('input:trigger', ({ action }) => {
        if (action === 'toggleMap' && this.loaded) this.setMapMode(!this.mapMode);
      }),
    );

    this.addLighting();

    if (destination) {
      this.jumpTo(destination);
    } else if (returnFrom) {
      this.placeAboveSite(returnFrom);
    } else {
      // Start near Arrakis and already drifting towards it, so the first frame
      // shows a lit planet with its terminator and the star off to one side.
      this.jumpTo(SPAWN_BODY);
    }

    this.loaded = true;
    this.bus.emit('screen:fade', { opacity: 0, seconds: 0.8 });
  }

  // ------------------------------------------------------------------ landing

  /**
   * Unit V: ray vs sphere. The planet under the reticle (ship's nose), nearest
   * first, within LANDING_RANGE_RADII. Uses each planet's tallest-mountain
   * radius so you can target a peak on the limb.
   */
  findLandingTarget(): { node: SolarSystem['planets'][number]; point: THREE.Vector3 } | null {
    const origin = this.ship.position;
    const direction = this.ship.getForward(this.forwardScratch);
    let best: { node: SolarSystem['planets'][number]; point: THREE.Vector3 } | null = null;
    let bestT = Infinity;
    for (const node of this.solarSystem.planets) {
      const radius = node.planet.radius * (1 + node.data.generation.noise.amplitude);
      const t = raySphere(origin, direction, node.position, radius);
      if (t === null || t > node.planet.radius * LANDING_RANGE_RADII || t >= bestT) continue;
      bestT = t;
      best = { node, point: origin.clone().addScaledVector(direction, t) };
    }
    return best;
  }

  /** L in space: warp down to the targeted point, if there is one. */
  private tryLand(): void {
    const target = this.findLandingTarget();
    if (!target) return;
    // World -> the planet's own frame, where its terrain is defined.
    const toPlanet = this.solarSystem.planetFrame(target.node).invert();
    const site = target.point.clone().sub(target.node.position).normalize().applyQuaternion(toPlanet);
    const sun = target.node.position.clone().negate().normalize().applyQuaternion(toPlanet); // star at origin
    const landing: LandingSite = {
      planetId: target.node.data.id,
      site: [site.x, site.y, site.z],
      sun: [sun.x, sun.y, sun.z],
      time: this.solarSystem.simulationTime,
    };
    this.savedTime = this.solarSystem.simulationTime;
    const warp: WarpPayload = { direction: 'down', landing };
    this.bus.emit('state:request', { to: 'Warp', payload: warp });
  }

  /**
   * Day 9, Mentat teleport from space: a body alone -> blink to its orbit;
   * a planet + landmark -> warp straight down beside that landmark (day side).
   */
  private mentatTeleport(bodyId: string, poiId: string | null): void {
    if (!poiId) {
      this.bus.emit('screen:fade', { opacity: 1, seconds: 0 });
      this.jumpTo(bodyId);
      this.bus.emit('screen:fade', { opacity: 0, seconds: 0.7 });
      return;
    }
    const node = this.solarSystem.planets.find((p) => p.data.id === bodyId);
    if (!node) return;
    this.savedTime = this.solarSystem.simulationTime;
    const warp: WarpPayload = { direction: 'down', landing: daysideLandingSite(node.data, this.savedTime, poiId) };
    this.bus.emit('state:request', { to: 'Warp', payload: warp });
  }

  /** Back from the surface: above the site we left, nose pointing up and away. */
  private placeAboveSite(landing: LandingSite): void {
    const node = this.solarSystem.planets.find((p) => p.data.id === landing.planetId);
    if (!node) {
      this.jumpTo(SPAWN_BODY);
      return;
    }
    const up = new THREE.Vector3(...landing.site).applyQuaternion(this.solarSystem.planetFrame(node)).normalize();
    const position = node.position.clone().addScaledVector(up, node.planet.radius * 1.9);
    this.placeShip(position, position.clone().add(up), 25);
  }

  /**
   * Put the ship a few planet radii from a body, on its day side and slightly
   * above the orbital plane, facing it and drifting gently towards it.
   * A teleport, so the interpolation history is reset (no smeared frame).
   * Used for the spawn and by the debug panel's "jump to".
   */
  jumpTo(id: string): void {
    this.trail?.reset();
    if (id === BELT_ID) {
      this.jumpToBelt();
      return;
    }
    const target = this.solarSystem.getWorldPosition(id);
    if (!target) {
      console.warn(`SpaceScene.jumpTo: no body "${id}"`);
      return;
    }
    const body = this.solarSystem.bodies.find((b) => b.id === id);
    // The anomaly's visible size is its disk, not its tiny horizon.
    const radius = !body ? 200 : 'radius' in body.physical ? body.physical.radius : body.physical.diskOuter;

    // Offset from the planet towards the star (the day side), rotated 70
    // degrees round so the terminator is in view, and lifted a little.
    const starPosition = this.solarSystem.getWorldPosition(this.solarSystem.star.data.id) ?? new THREE.Vector3();
    const towardsStar = starPosition.clone().sub(target);
    if (towardsStar.lengthSq() < 1e-6) towardsStar.set(0, 0, 1); // jumping to the star itself
    towardsStar.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(70));
    const distance = radius * 4.5;
    const position = target.clone().addScaledVector(towardsStar, distance).add(new THREE.Vector3(0, radius * 0.8, 0));

    // Matrix4.lookAt(eye, target) builds the rotation whose -Z points from eye
    // to target — exactly the ship's forward axis (same call as CameraRig).
    this.placeShip(position, target, 12);
  }

  /**
   * Just inside the belt (star side), slightly above its plane, facing out:
   * the star is behind you so the rocks are lit, and throttling up flies you
   * straight through them.
   */
  private jumpToBelt(): void {
    const { innerRadius, outerRadius } = this.asteroids.config;
    const position = this.asteroids.pointOnBelt(innerRadius - 350).add(new THREE.Vector3(0, 30, 0));
    const target = this.asteroids.pointOnBelt(outerRadius);
    this.placeShip(position, target, 12);
  }

  private placeShip(position: THREE.Vector3, target: THREE.Vector3, speed: number): void {
    const look = new THREE.Matrix4().lookAt(position, target, new THREE.Vector3(0, 1, 0));
    this.ship.orientation.setFromRotationMatrix(look);
    this.ship.position.copy(position);
    this.ship.velocity.copy(target).sub(position).normalize().multiplyScalar(speed);
    this.ship.angularVelocity.set(0, 0, 0);
    this.ship.syncRenderTransform();
    this.rig.snapToShip();
  }

  /**
   * Canopus owns the key light (a PointLight in Star.ts). This adds only a dim
   * hemisphere fill, so the hull's shadowed side reads as a 3D shape rather
   * than a silhouette.
   */
  private addLighting(): void {
    this.fillLight = new THREE.HemisphereLight(0x3a4a66, 0x0a0a12, 0.55);
    this.fillLight.name = 'FillLight';
    this.scene.add(this.fillLight);
  }

  update(dt: number): void {
    if (!this.loaded) return;
    this.elapsed += dt;

    // Order matters: snapshot the old state first so render() can interpolate.
    this.ship.saveState();
    this.solarSystem.update(dt);
    this.controller.update(dt);
    this.resolveCollisions(dt);
    this.emitTrail(dt);
    this.rig.update(dt);

    this.stepCount++;
    if (this.stepCount % PREDICT_EVERY_N_STEPS === 0) this.predict();
    if (this.stepCount % NAV_EVERY_N_STEPS === 0) this.publishNavigation();

    if (this.pendingRespawn) {
      // Outside the event handler, so the bus is not re-entered mid-emit.
      this.pendingRespawn = false;
      this.ship.hull = this.ship.maxHull;
      this.jumpTo(SPAWN_BODY);
    }
  }

  /** Unit V: collision detection and response, on the fixed step. */
  private resolveCollisions(dt: number): void {
    const ship = this.ship;
    const radius = ship.boundingRadius;

    this.asteroids.collideSphere(ship.position, radius, this.asteroidContacts);
    for (const contact of this.asteroidContacts) this.respond(contact, 'asteroid', null);

    this.solarSystem.collideSphere(ship.position, radius, dt, this.bodyContacts);
    for (const contact of this.bodyContacts) this.respond(contact, contact.bodyId, contact.bodyVelocity);
  }

  private respond(
    contact: AsteroidContact | BodyContact,
    bodyId: string,
    bodyVelocity: THREE.Vector3 | null,
  ): void {
    const { impactSpeed } = resolveContact(
      this.ship.position,
      this.ship.velocity,
      contact,
      this.impact.restitution,
      this.impact.friction,
      bodyVelocity ?? undefined,
    );
    // Resting or grazing contact: pushed out, but not an "impact".
    if (impactSpeed < 1) return;

    // Crossing the anomaly's photon sphere is not survivable at any speed.
    const fatal = bodyId === this.solarSystem.anomaly?.data.id;
    const damage = fatal
      ? this.ship.hull
      : impactDamage(impactSpeed, this.impact.damageThreshold, this.impact.damagePerSpeed);
    this.ship.hull = Math.max(0, this.ship.hull - damage);
    this.bus.emit('ship:collision', { bodyId, impactSpeed, damage, hull: this.ship.hull });
    if (this.ship.hull <= 0 && !this.pendingRespawn) this.bus.emit('ship:destroyed', { bodyId });
  }

  /** Unit V: integrate a copy of the ship forward with engines off. */
  private predict(): void {
    if (!this.trajectory.visible) return;
    const result = predictTrajectory(
      this.ship.position,
      this.ship.velocity,
      this.predictionEnvironment,
      PREDICTION_STEPS,
      PREDICTION_DT,
      this.controller.tuning.idleDamping,
      this.trajectory.points,
    );
    this.impactBodyId = result.impactBodyId;
    this.trajectory.commit(result.count, result.impactBodyId !== null);
  }

  /** 10 Hz navigation fix for the HUD, radar and lore card (EventBus only). */
  private publishNavigation(): void {
    const fix = this.solarSystem.navigationFix(this.ship.position);
    const nameOf = (id: string | null): string | null =>
      id === null ? null : (this.solarSystem.bodies.find((b) => b.id === id)?.name ?? id);

    // Radar frame: the ship's heading flattened onto the system plane.
    this.ship.getForward(this.forwardScratch).setY(0);
    if (this.forwardScratch.lengthSq() < 1e-6) this.forwardScratch.set(0, 0, -1);
    this.forwardScratch.normalize();
    const fx = this.forwardScratch.x;
    const fz = this.forwardScratch.z;

    const blips: Array<{ id: string; name: string; kind: 'star' | 'planet' | 'blackhole'; x: number; z: number; radius: number }> = [];
    for (const body of this.solarSystem.bodies) {
      const position = this.solarSystem.getWorldPosition(body.id, this.relativeScratch);
      if (!position) continue;
      position.sub(this.ship.position);
      // right = (-fz, 0, fx); ahead = (fx, 0, fz). Radar x = right, z = -ahead.
      blips.push({
        id: body.id,
        name: body.name,
        kind: body.type,
        x: position.x * -fz + position.z * fx,
        z: -(position.x * fx + position.z * fz),
        radius: 'radius' in body.physical ? body.physical.radius : body.physical.diskOuter,
      });
    }

    this.bus.emit('nav:update', {
      nearestId: fix.nearestId,
      nearestName: fix.nearestName,
      altitude: fix.altitude,
      nearestRadius: fix.nearestRadius,
      dominantName: nameOf(fix.dominantId),
      gravity: this.controller.gravityMagnitude,
      impactName: nameOf(this.impactBodyId),
      landingTarget: this.findLandingTarget()?.node.data.name ?? null,
      blips,
    });
  }

  /** Unit V: particles. Emission on the fixed step, from the simulated nozzle. */
  private emitTrail(dt: number): void {
    this.ship.getNozzle(this.nozzle);
    this.backward.set(0, 0, 1).applyQuaternion(this.ship.orientation);
    this.trail.emit(
      this.nozzle,
      this.backward,
      this.ship.velocity,
      this.controller.throttle,
      this.controller.isBoosting,
      this.elapsed,
      dt,
    );
  }

  /** Unit IV: switch between the perspective chase view and the orthographic map. */
  setMapMode(on: boolean): void {
    this.mapMode = on;
    this.postFX.setCamera(on ? this.map.camera : this.rig.camera);
  }

  /** X-Ray: ship, star, anomaly, planets (peak terrain) and the rocks near the ship. */
  private collectBoundingSpheres(out: THREE.Sphere[]): void {
    out.push(new THREE.Sphere(this.ship.root.position.clone(), this.ship.boundingRadius));
    out.push(new THREE.Sphere(new THREE.Vector3(), this.solarSystem.star.radius));
    const anomaly = this.solarSystem.anomaly;
    if (anomaly) {
      out.push(new THREE.Sphere(anomaly.blackHole.root.getWorldPosition(new THREE.Vector3()), anomaly.blackHole.photonSphereRadius));
    }
    for (const node of this.solarSystem.planets) {
      out.push(
        new THREE.Sphere(
          node.orbitPivot.getWorldPosition(new THREE.Vector3()),
          node.planet.radius * (1 + node.data.generation.noise.amplitude),
        ),
      );
    }
    this.asteroids.nearbySpheres(this.ship.root.position, 2500, out);
  }

  /** Draws through PostFX, which holds the same renderer. */
  render(alpha: number, renderer: THREE.WebGLRenderer): void {
    if (!this.loaded) return;

    this.ship.applyInterpolated(alpha);
    this.rig.applyInterpolated(alpha);
    this.solarSystem.applyInterpolated(alpha);
    this.solarSystem.setCameraPosition(this.rig.camera.position);
    this.skybox.update(this.elapsed, this.rig.camera.position);
    this.asteroids.updateTumble(this.elapsed, this.rig.camera.position);
    this.trail.setTime(this.elapsed);

    if (this.mapMode) {
      this.map.update(
        (id, out) => this.solarSystem.getWorldPosition(id, out),
        this.ship.root.position,
        this.ship.getForward(this.forwardScratch),
      );
    }
    this.xray.update();

    // Lensing follows the anomaly's interpolated screen position (not in the map).
    const anomaly = this.solarSystem.anomaly;
    if (anomaly && !this.mapMode) {
      anomaly.blackHole.root.getWorldPosition(this.relativeScratch);
      this.postFX.lensing.setLens(
        this.relativeScratch,
        anomaly.blackHole.schwarzschildRadius,
        anomaly.blackHole.diskOuter,
        this.rig.camera,
      );
    } else {
      this.postFX.lensing.deactivate();
    }
    this.postFX.render(1 / 60);
    this.xray.renderOverlay(renderer);
  }

  resize(width: number, height: number): void {
    this.rig?.resize(width, height);
    this.map?.resize(width, height);
    this.trail?.setViewportHeight(height * this.renderer.getPixelRatio());
    this.postFX?.setSize(width, height);
    this.skybox.setPixelRatio(this.renderer.getPixelRatio());
  }

  /** CLAUDE.md: dispose geometries, materials and textures when a scene unloads. */
  exit(): void {
    this.loaded = false;
    this.skybox.dispose(this.scene);
    this.ship.dispose();
    this.scene.remove(this.ship.root);
    this.solarSystem.dispose();
    this.asteroids.dispose();
    this.trail.dispose();
    this.trajectory.dispose();
    this.xray.dispose();
    this.map.dispose();
    this.postFX.dispose();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    if (this.fillLight) {
      this.fillLight.dispose();
      this.scene.remove(this.fillLight);
      this.fillLight = null;
    }
    this.scene.clear();
  }
}
