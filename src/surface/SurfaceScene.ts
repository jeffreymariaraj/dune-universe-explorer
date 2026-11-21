// Day 7-8. Unit V: surface deformation, kinematics and heightfield collision;
// Unit IV: viewing (first-person camera, fog as a far-plane disguise).
//
// The on-ground scene, generated from the planet's seed AND the exact point you
// landed on: physics/terrain.ts wraps the local ground back onto the planet's
// sphere around the landing site and samples the same terrain function the
// planet shader displaced in orbit. Seas, hills and dry plains are where the
// orbital view put them, and the sun's height comes from where that point was
// facing the star when you landed — land on the night side and it is night.
//
// Owns:
//   TerrainManager    3x3 recycled chunks around the walker (Day 7)
//   Walker            walk / run / jump / swim under THIS planet's gravity,
//                     g = G M / R^2, clamped to the heightfield (Day 8)
//   sky dome          gradient + sun + night stars from the atmosphere colour
//   fog and dust      per biome (surface/Biomes.ts)
//   PointsOfInterest  2-3 landmarks from planets.json, with a card on approach
//   PostFX            bloom + tone mapping (no lensing down here)
// "Return to orbit" (L) asks for Warp back to Space.

import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { InputManager } from '../core/InputManager';
import type { GameState } from '../core/StateMachine';
import { loadSystemData, type PlanetData } from '../data/systemData';
import { siteFrame, terrainHeight, terrainParamsFor, waterLevel, type SiteFrame, type TerrainParams } from '../physics/terrain';
import { PostFX } from '../render/PostFX';
import { XRay } from '../render/XRay';
import { Planet } from '../space/Planet';
import { DEFAULT_GRAVITY_CONSTANT } from '../space/SolarSystem';
import dustVertex from '../shaders/dust.vert.glsl';
import dustFragment from '../shaders/dust.frag.glsl';
import skyVertex from '../shaders/sky.vert.glsl';
import skyFragment from '../shaders/sky.frag.glsl';
import { biomeFor, type Biome } from './Biomes';
import { PointsOfInterest } from './PointsOfInterest';
import { TerrainManager } from './TerrainManager';
import { Walker } from './Walker';
import { daysideLandingSite } from '../space/landing';

/** Where on which planet you landed: everything the surface needs to rebuild it. */
export interface LandingSite {
  planetId: string;
  /** Landing direction in the planet's own (spinning, tilted) frame, unit length. */
  site: [number, number, number];
  /** Direction to the star in the same frame at the moment of landing. */
  sun: [number, number, number];
  /** Simulation time of the landing (orbits are frozen while landed). */
  time: number;
  /** Day 9: arrive beside this landmark (Mentat teleport) instead of at the site. */
  poiId?: string;
}

/** Warp carries this in both directions. */
export interface WarpPayload {
  direction: 'down' | 'up';
  landing: LandingSite;
  /** Going up: jump to this body's orbit instead of above the landing site (Mentat teleport). */
  destination?: string;
}

/** Landmark card opens within this many units. */
const POI_APPROACH = 18;
/** Status for the HUD every N fixed steps (10 Hz). */
const STATUS_EVERY_N_STEPS = 12;
/** Side of the box of dust motes that follows the camera. */
const DUST_EXTENT = 70;

export class SurfaceScene implements GameState {
  readonly name = 'Surface' as const;

  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 2400);
  terrain: TerrainManager | null = null;
  walker: Walker | null = null;
  pointsOfInterest: PointsOfInterest | null = null;
  postFX: PostFX | null = null;
  xray: XRay | null = null;
  landing: LandingSite | null = null;
  planet: PlanetData | null = null;

  private params: TerrainParams | null = null;
  private frame: SiteFrame | null = null;
  private water: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null;
  private skyDome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  private dust: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private skyLight: THREE.HemisphereLight | null = null;
  private unsubscribe: (() => void) | null = null;
  private loaded = false;
  private elapsed = 0;
  private stepCount = 0;
  private nearPoi: string | null = null;
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    private readonly input: InputManager,
    private readonly bus: EventBus,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.scene.name = 'SurfaceScene';
    this.camera.name = 'WalkerCamera';
  }

  enter(payload?: unknown): void {
    const landing = (payload as LandingSite | undefined) ?? null;
    if (!landing) throw new Error('SurfaceScene: entered without a landing site');
    const planet = loadSystemData().bodies.find((b): b is PlanetData => b.type === 'planet' && b.id === landing.planetId);
    if (!planet) throw new Error(`SurfaceScene: unknown planet "${landing.planetId}"`);
    this.landing = landing;
    this.planet = planet;
    this.elapsed = 0;
    this.stepCount = 0;
    this.nearPoi = null;

    // ---- terrain: the planet's own height function around the landing site
    const biome = biomeFor(planet.generation.biome);
    const params = terrainParamsFor(
      Planet.heightParamsFor(planet),
      landing.site,
      planet.generation.seed,
      planet.generation.biome === 'desert', // ridged detail = dunes
    );
    const frame = siteFrame(landing.site);
    this.params = params;
    this.frame = frame;
    const sea = waterLevel(params);
    this.buildTerrain(planet, biome, params, frame, sea);

    // ---- sky, sun, fog and dust from where the site faced the star at landing
    const sunLocal = this.sunInLocalFrame(landing.sun, landing.site, frame);
    const daylight = THREE.MathUtils.smoothstep(sunLocal.y, -0.12, 0.25);
    this.buildSky(planet, biome, sunLocal, daylight);

    // ---- landmarks, then the walker at the landing point
    this.pointsOfInterest = new PointsOfInterest(
      planet.pointsOfInterest,
      (x, z) => this.groundAt(x, z),
      planet.generation.seed,
    );
    this.scene.add(this.pointsOfInterest.root);

    // Unit V: surface gravity of THIS planet, g = G M / R^2 (planets.json mass and radius).
    const gravity = (DEFAULT_GRAVITY_CONSTANT * planet.physical.mass) / planet.physical.radius ** 2;
    this.walker = new Walker(
      {
        height: (x, z) => this.groundAt(x, z),
        isWater: (x, z) => sea !== null && terrainHeight(x, z, params, frame) < sea,
      },
      this.input,
      gravity,
    );
    // Face the first landmark, so there is something to walk towards — or,
    // after a Mentat teleport, stand right beside the requested one.
    const first = this.pointsOfInterest.placed[0];
    const yaw = first ? Math.atan2(-first.position.x, -first.position.z) : 0;
    this.walker.placeAt(0, 0, yaw);
    if (landing.poiId) this.standBeside(landing.poiId);

    const size = this.renderer.getSize(new THREE.Vector2());
    this.postFX = new PostFX(this.renderer, this.scene, this.camera, { lensing: false });
    this.resize(size.x, size.y);

    // Day 10: the X-Ray panel works on foot too (wireframe terrain, normals,
    // depth buffer, frustum, the camera's matrix).
    this.xray = new XRay(document.getElementById('overlay') ?? document.body, this.bus, {
      scene: this.scene,
      camera: this.camera,
      postFX: this.postFX,
      normalsMesh: () => (this.walker ? (this.terrain?.meshAt(this.walker.position.x, this.walker.position.z) ?? null) : null),
      boundingSpheres: (out) => {
        if (this.walker) out.push(new THREE.Sphere(this.walker.position.clone().setY(this.walker.position.y + 0.9), 0.9));
        for (const poi of this.pointsOfInterest?.placed ?? []) {
          const box = new THREE.Box3().setFromObject(poi.group, true);
          // The light beam is not part of the landmark's body.
          box.max.y = Math.min(box.max.y, poi.position.y + 25);
          out.push(box.getBoundingSphere(new THREE.Sphere()));
        }
      },
      matrix: () => ({ label: 'Camera matrix (world, = inverse view)', matrix: this.camera.matrixWorld }),
      stateName: () => `Surface (${this.planet?.name ?? '?'})`,
    });

    const offTrigger = this.bus.on('input:trigger', ({ action }) => {
      if (action === 'land' && this.landing) {
        const up: WarpPayload = { direction: 'up', landing: this.landing };
        this.bus.emit('state:request', { to: 'Warp', payload: up });
      }
    });
    const offTeleport = this.bus.on('mentat:teleport', ({ bodyId, poiId }) => this.teleport(bodyId, poiId));
    this.unsubscribe = () => {
      offTrigger();
      offTeleport();
    };

    this.loaded = true;
    this.bus.emit('surface:entered', {
      planetName: planet.name,
      biome: planet.generation.biome,
      daylight: daylight > 0.5,
    });
    this.bus.emit('screen:fade', { opacity: 0, seconds: 0.9 });
  }

  /**
   * Day 9, Mentat teleport from the surface:
   *   same planet + landmark  -> a quick fade and you stand beside it
   *   other planet + landmark -> warp straight down onto that planet (day side)
   *   a body with no landmark -> warp up into that body's orbit
   */
  private teleport(bodyId: string, poiId: string | null): void {
    if (!this.landing || !this.planet) return;
    if (poiId && bodyId === this.planet.id) {
      this.bus.emit('screen:fade', { opacity: 1, seconds: 0 });
      this.standBeside(poiId);
      this.bus.emit('screen:fade', { opacity: 0, seconds: 0.7 });
      return;
    }
    if (poiId) {
      const target = loadSystemData().bodies.find((b): b is PlanetData => b.type === 'planet' && b.id === bodyId);
      if (!target) return;
      const down: WarpPayload = { direction: 'down', landing: daysideLandingSite(target, this.landing.time, poiId) };
      this.bus.emit('state:request', { to: 'Warp', payload: down });
      return;
    }
    const up: WarpPayload = { direction: 'up', landing: this.landing, destination: bodyId };
    this.bus.emit('state:request', { to: 'Warp', payload: up });
  }

  /** Put the walker 12 u from a landmark, facing it. */
  private standBeside(poiId: string): void {
    const poi = this.pointsOfInterest?.placed.find((p) => p.data.id === poiId);
    if (!poi || !this.walker || !this.terrain) return;
    const away = Math.hypot(poi.position.x, poi.position.z) > 1e-3 ? new THREE.Vector2(poi.position.x, poi.position.z).normalize() : new THREE.Vector2(0, 1);
    const x = poi.position.x - away.x * 12;
    const z = poi.position.z - away.y * 12;
    this.walker.placeAt(x, z, Math.atan2(-(poi.position.x - x), -(poi.position.z - z)));
    this.terrain.generateAround(x, z); // behind the fade: build the new window at once
    this.nearPoi = null;
  }

  /** Ground or water height under (x, z): what the walker stands on. One function for mesh and collision. */
  groundAt(x: number, z: number): number {
    if (!this.params || !this.frame) return 0;
    const ground = terrainHeight(x, z, this.params, this.frame);
    const sea = waterLevel(this.params);
    return sea === null ? ground : Math.max(ground, sea);
  }

  update(dt: number): void {
    if (!this.loaded || !this.terrain || !this.walker) return;
    this.elapsed += dt;
    this.walker.update(dt);
    this.terrain.update(this.walker.position.x, this.walker.position.z);
    if (++this.stepCount % STATUS_EVERY_N_STEPS === 0) this.publishStatus();
  }

  /** 10 Hz: nearest landmark for the HUD, and the landmark card on approach. */
  private publishStatus(): void {
    const walker = this.walker;
    if (!walker || !this.pointsOfInterest) return;
    const fix = this.pointsOfInterest.nearest(walker.position, walker.yaw);
    const mode = walker.swimming ? 'swimming' : !walker.grounded ? 'airborne' : walker.speed > walker.tuning.walkSpeed + 1 ? 'running' : 'walking';
    this.bus.emit('surface:status', {
      mode,
      gravity: walker.gravity,
      poiName: fix?.poi.data.name ?? null,
      poiDistance: fix?.distance ?? 0,
      poiBearing: fix?.bearing ?? 0,
    });

    const near = fix && fix.distance < POI_APPROACH ? fix.poi.data : null;
    if (near && near.id !== this.nearPoi) {
      this.nearPoi = near.id;
      this.bus.emit('poi:approach', { name: near.name, kind: near.kind, description: near.description });
    } else if (!near && this.nearPoi && fix && fix.distance > POI_APPROACH * 1.5) {
      this.nearPoi = null;
      this.bus.emit('poi:leave', {});
    }
  }

  render(alpha: number, renderer: THREE.WebGLRenderer): void {
    if (!this.loaded || !this.postFX || !this.walker) return;
    const walker = this.walker;
    walker.eye(alpha, this.camera.position);
    this.euler.set(
      THREE.MathUtils.lerp(walker.prevPitch, walker.pitch, alpha),
      THREE.MathUtils.lerp(walker.prevYaw, walker.yaw, alpha),
      0,
    );
    this.camera.quaternion.setFromEuler(this.euler);

    // Things that ride with the camera.
    this.skyDome?.position.copy(this.camera.position);
    if (this.water) this.water.position.set(this.camera.position.x, this.water.position.y, this.camera.position.z);
    if (this.dust) {
      const u = this.dust.material.uniforms;
      u['uTime']!.value = this.elapsed;
      u['uCameraPos']!.value.copy(this.camera.position);
    }
    this.pointsOfInterest?.animate(this.elapsed);
    this.xray?.update();
    this.postFX.render(1 / 60);
    this.xray?.renderOverlay(renderer);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.postFX?.setSize(width, height);
    if (this.dust) this.dust.material.uniforms['uViewportHeight']!.value = height * this.renderer.getPixelRatio();
  }

  /** CLAUDE.md: dispose geometries, materials and textures when a scene unloads. */
  exit(): void {
    this.loaded = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.nearPoi) this.bus.emit('poi:leave', {});
    this.nearPoi = null;
    this.terrain?.dispose();
    this.terrain = null;
    this.pointsOfInterest?.dispose();
    this.pointsOfInterest = null;
    this.walker = null;
    for (const mesh of [this.water, this.skyDome, this.dust]) {
      if (!mesh) continue;
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.water = null;
    this.skyDome = null;
    this.dust = null;
    this.sun?.dispose();
    this.skyLight?.dispose();
    this.sun = null;
    this.skyLight = null;
    this.xray?.dispose();
    this.xray = null;
    this.postFX?.dispose();
    this.postFX = null;
    this.scene.clear();
    this.scene.background = null;
    this.scene.fog = null;
  }

  // ------------------------------------------------------------------ building

  private buildTerrain(planet: PlanetData, biome: Biome, params: TerrainParams, frame: SiteFrame, sea: number | null): void {
    const palette = planet.generation.palette.map((hex) => new THREE.Color(hex));
    const rock = new THREE.Color('#5a5048');
    const shore = new THREE.Color(biome.water?.shallow ?? planet.generation.palette[1]);
    const colourAt = (height: number, normalY: number, out: THREE.Color): THREE.Color => {
      // Height -> palette ramp (low, mid, high), steep slopes -> bare rock.
      const t = THREE.MathUtils.clamp((height / params.relief + 1) / 2, 0, 1);
      if (t < 0.5) out.copy(palette[0]!).lerp(palette[1]!, t * 2);
      else out.copy(palette[1]!).lerp(palette[2]!, (t - 0.5) * 2);
      const steep = 1 - THREE.MathUtils.smoothstep(normalY, 0.7, 0.92); // 1 on cliffs
      out.lerp(rock, steep * 0.7);
      if (sea !== null && height < sea + 1.5) out.lerp(shore, 0.6); // wet sand / seabed
      return out;
    };

    this.terrain = new TerrainManager((x, z) => terrainHeight(x, z, params, frame), colourAt);
    this.terrain.generateAround(0, 0);
    this.scene.add(this.terrain.root);

    if (sea !== null) {
      const deep = new THREE.Color(biome.water?.deep ?? planet.generation.palette[0]);
      this.water = new THREE.Mesh(
        new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: deep, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.88 }),
      );
      this.water.name = 'Water';
      this.water.position.y = sea;
      this.scene.add(this.water);
    }
  }

  private buildSky(planet: PlanetData, biome: Biome, sunLocal: THREE.Vector3, daylight: number): void {
    const atmosphere = new THREE.Color(planet.generation.atmosphere.color);
    const night = new THREE.Color('#05060b');
    const horizon = atmosphere.clone().lerp(new THREE.Color('#ffffff'), 0.3);
    const zenith = atmosphere.clone().multiplyScalar(0.55);
    // What the eye sees at the horizon right now, which the fog must match.
    const horizonNow = night.clone().multiplyScalar(1.6).lerp(horizon, daylight);

    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        uniforms: {
          uZenith: { value: zenith },
          uHorizon: { value: horizon },
          uNight: { value: night },
          uSunDirection: { value: sunLocal.clone() },
          uSunColor: { value: new THREE.Color('#fff1d6') },
          uDaylight: { value: daylight },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.skyDome.name = 'SkyDome';
    this.skyDome.renderOrder = -1000;
    this.skyDome.frustumCulled = false;
    this.scene.add(this.skyDome);
    this.scene.background = horizonNow;
    // Unit IV: linear fog hides the far edge of the 3x3 chunk window; thick
    // air (desert, industrial) closes in sooner.
    this.scene.fog = new THREE.Fog(horizonNow, biome.fog.near, biome.fog.far);

    this.sun = new THREE.DirectionalLight(0xfff1d6, 0.15 + 2.4 * daylight);
    this.sun.position.copy(sunLocal.y > 0.02 ? sunLocal : new THREE.Vector3(0.3, 1, 0.2)).normalize().multiplyScalar(500);
    this.scene.add(this.sun);
    this.skyLight = new THREE.HemisphereLight(horizonNow, new THREE.Color(planet.generation.palette[0]), 0.25 + 0.55 * daylight);
    this.scene.add(this.skyLight);

    // Dust / spray / ash / snow, by biome.
    const count = biome.dust.count;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const random = Math.random;
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (random() - 0.5) * DUST_EXTENT;
      positions[i * 3 + 1] = (random() - 0.5) * DUST_EXTENT;
      positions[i * 3 + 2] = (random() - 0.5) * DUST_EXTENT;
      phases[i] = random() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.dust = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: dustVertex,
        fragmentShader: dustFragment,
        uniforms: {
          uTime: { value: 0 },
          uWind: { value: new THREE.Vector3(...biome.dust.wind) },
          uCameraPos: { value: new THREE.Vector3() },
          uExtent: { value: DUST_EXTENT },
          uSize: { value: biome.dust.size },
          uViewportHeight: { value: 1080 },
          // Dust is lit by the sky: dim it at night.
          uColor: { value: new THREE.Color(biome.dust.color).multiplyScalar(0.25 + 0.75 * daylight) },
          uOpacity: { value: biome.dust.opacity },
        },
        transparent: true,
        depthWrite: false,
      }),
    );
    this.dust.name = 'Dust';
    this.dust.frustumCulled = false; // the shader moves every mote
    this.scene.add(this.dust);
  }

  /** Star direction from the planet frame into the local (east, up, south) frame. */
  private sunInLocalFrame(
    sun: readonly [number, number, number],
    site: readonly [number, number, number],
    frame: SiteFrame,
  ): THREE.Vector3 {
    const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    // Local x = east, y = up (the site normal), z = south (= -north).
    return new THREE.Vector3(dot(sun, frame.east), dot(sun, site), -dot(sun, frame.north)).normalize();
  }
}
