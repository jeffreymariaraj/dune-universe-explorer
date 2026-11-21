// Not a syllabus feature: the instrument panel we develop against.
// three.js Stats for frame time, lil-gui for live tuning (SYSTEM_DESIGN.md 2).
//
// Day 1 shows ship speed (read-only, fed by 'ship:telemetry') and camera damping,
// plus the flight tuning that needs feel-testing. Day 2 adds the solar system:
// time scale, pause, orbit lines, terminator tuning and a "jump to" teleport.
// Day 3 adds atmosphere and wireframe toggles and the nearest planet's LOD level.
// Day 4 adds the Collisions folder: hull, last impact, octree size, impact tuning. The X-Ray checkboxes from
// section 11 are added to their own folder on Day 10.

import GUI from 'lil-gui';
import Stats from 'three/addons/libs/stats.module.js';
import type { Engine } from '../core/Engine';
import type { EventBus } from '../core/EventBus';
import type { InputManager } from '../core/InputManager';
import type { CameraRig } from '../ship/CameraRig';
import type { SolarSystem } from '../space/SolarSystem';
import type { AsteroidField } from '../space/AsteroidField';
import type { ImpactTuning } from '../space/SpaceScene';
import type { PostFX } from '../render/PostFX';
import type { AudioManager } from '../core/AudioManager';
import { DEFAULT_PLANET_SHADING } from '../space/Planet';
import type { ShipController } from '../ship/ShipController';

/** Values lil-gui displays but never writes back. */
interface Readouts {
  speed: number;
  fps: number;
  position: string;
  boosting: boolean;
  skyMode: string;
  shipModel: string;
  mouseFlight: boolean;
  simTime: string;
  lod: string;
  hull: number;
  lastImpact: string;
  octree: string;
  drawCalls: number;
  triangles: string;
}

/** What the Solar system folder needs from the space scene. */
export interface SolarSystemControls {
  system: SolarSystem;
  jumpTo: (id: string) => void;
  asteroids: AsteroidField;
  impact: ImpactTuning;
  /** Extra "jump to" entry for the belt. */
  beltId: string;
  postFX: PostFX;
  audio: AudioManager;
}

export class DebugOverlay {
  private readonly gui = new GUI({ title: 'Known Universe — Day 10' });
  private readonly stats: Stats;
  private readonly readouts: Readouts;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    engine: Engine,
    bus: EventBus,
    controller: ShipController,
    rig: CameraRig,
    input: InputManager,
    info: { skyMode: string; shipModel: string },
    solar: SolarSystemControls,
  ) {
    this.stats = new Stats();
    this.stats.dom.style.position = 'fixed';
    this.stats.dom.style.top = '0';
    this.stats.dom.style.left = '0';
    document.body.appendChild(this.stats.dom);

    engine.onBeforeFrame = () => this.stats.begin();
    engine.onAfterFrame = () => this.stats.end();

    this.readouts = {
      speed: 0,
      fps: 60,
      position: '0, 0, 0',
      boosting: false,
      skyMode: info.skyMode,
      shipModel: info.shipModel,
      mouseFlight: input.isPointerLocked,
      simTime: '0 s',
      lod: '-',
      hull: 100,
      lastImpact: 'none',
      octree: '-',
      drawCalls: 0,
      triangles: '0',
    };

    const telemetry = this.gui.addFolder('Telemetry');
    telemetry.add(this.readouts, 'speed').name('speed (u/s)').listen().disable();
    telemetry.add(this.readouts, 'fps').name('fps').listen().disable();
    telemetry.add(this.readouts, 'position').name('position').listen().disable();
    telemetry.add(this.readouts, 'boosting').name('boosting').listen().disable();
    telemetry.add(this.readouts, 'mouseFlight').name('mouse flight').listen().disable();
    // Day 10 perf pass: the whole frame (every post-processing pass), not just the last.
    telemetry.add(this.readouts, 'drawCalls').name('draw calls').listen().disable();
    telemetry.add(this.readouts, 'triangles').name('triangles').listen().disable();
    telemetry.add(engine, 'maxPixelRatio', { '1x': 1, '1.5x': 1.5, '2x': 2 }).name('render scale');

    const camera = this.gui.addFolder('Camera');
    camera.add(rig.tuning, 'damping', 0.5, 20, 0.1).name('damping (1/s)');
    camera.add(rig.tuning, 'rotationDamping', 0.5, 25, 0.1).name('aim damping (1/s)');
    camera.add(rig.tuning, 'lookAhead', 0, 80, 1).name('look ahead');
    camera.add(rig.tuning, 'fov', 40, 100, 1).name('fov (deg)');
    camera.add(rig.tuning.offset, 'y', -10, 20, 0.1).name('seat height');
    camera.add(rig.tuning.offset, 'z', 2, 40, 0.1).name('seat distance');

    const flight = this.gui.addFolder('Flight');
    flight.add(controller.tuning, 'thrust', 5, 200, 1).name('thrust (u/s2)');
    flight.add(controller.tuning, 'boostMultiplier', 1, 8, 0.1).name('boost x');
    flight.add(controller.tuning, 'maxSpeed', 50, 2000, 10).name('max speed');
    flight.add(controller.tuning, 'brakeDamping', 0, 8, 0.1).name('brake (1/s)');
    flight.add(controller.tuning, 'yawRate', 0.1, 3, 0.05).name('yaw (rad/s)');
    flight.add(controller.tuning, 'pitchRate', 0.1, 3, 0.05).name('pitch (rad/s)');
    flight.add(controller.tuning, 'rollRate', 0.1, 4, 0.05).name('roll (rad/s)');

    // Unit V: kinematics. Speeding up time makes the Kepler orbits and the
    // spin about the tilted axis visible within a viva-length demo.
    const system = solar.system;
    const solarFolder = this.gui.addFolder('Solar system');
    solarFolder.add(this.readouts, 'simTime').name('sim time').listen().disable();
    solarFolder.add(system.tuning, 'timeScale', 0, 200, 1).name('time scale (x)');
    solarFolder.add(system.tuning, 'paused').name('pause orbits');
    solarFolder.add(system.tuning, 'showOrbits').name('orbit lines');
    solarFolder.add(system.tuning, 'showAtmospheres').name('atmospheres');
    solarFolder.add(system.tuning, 'gravityConstant', 0, 120_000, 1000).name('gravity G');
    solarFolder.add(system.tuning, 'wireframe').name('wireframe');
    solarFolder.add(this.readouts, 'lod').name('nearest LOD').listen().disable();
    const shading = { ...DEFAULT_PLANET_SHADING };
    const applyShading = (): void => {
      for (const node of system.planets) node.planet.setShading(shading);
    };
    solarFolder.add(shading, 'terminatorWidth', 0.01, 0.5, 0.01).name('terminator width').onChange(applyShading);
    solarFolder.add(shading, 'ambient', 0, 0.2, 0.005).name('night ambient').onChange(applyShading);
    const jump = { target: system.planets[0]?.data.id ?? system.star.data.id };
    const options: Record<string, string> = {};
    for (const body of system.bodies) options[body.name] = body.id;
    options['Asteroid belt'] = solar.beltId;
    solarFolder.add(jump, 'target', options).name('jump to').onChange((id: string) => solar.jumpTo(id));

    // Unit V: collision detection and response.
    let cells = 0;
    let deepest = 0;
    solar.asteroids.octree.forEachCell((cell) => {
      cells++;
      deepest = Math.max(deepest, cell.depth);
    });
    this.readouts.octree = `${solar.asteroids.octree.size} rocks, ${cells} cells, depth ${deepest}`;
    const collisions = this.gui.addFolder('Collisions');
    collisions.add(this.readouts, 'hull').name('hull').listen().disable();
    collisions.add(this.readouts, 'lastImpact').name('last impact').listen().disable();
    collisions.add(this.readouts, 'octree').name('octree').disable();
    collisions.add(solar.impact, 'restitution', 0, 1, 0.01).name('restitution');
    collisions.add(solar.impact, 'friction', 0, 1, 0.01).name('friction');
    collisions.add(solar.impact, 'damageThreshold', 0, 60, 1).name('damage above (u/s)');
    collisions.add(solar.impact, 'damagePerSpeed', 0, 2, 0.01).name('damage per u/s');
    collisions.add(solar.asteroids.root, 'visible').name('asteroids');

    // Unit I: the post-processing chain (Day 6).
    const post = this.gui.addFolder('Post FX');
    post.add(solar.postFX, 'enabled').name('post-processing');
    post.add(solar.postFX, 'multisampling', { off: 0, x2: 2, x4: 4 }).name('MSAA');
    post.add(solar.postFX.lensing, 'strength', 0, 4, 0.05).name('lensing strength');
    post.add(solar.postFX.bloom, 'intensity', 0, 4, 0.05).name('bloom');
    post.add(solar.postFX.bloom.luminanceMaterial, 'threshold', 0, 2, 0.01).name('bloom threshold');

    const sound = this.gui.addFolder('Audio');
    sound.add(solar.audio, 'volume', 0, 1, 0.05).name('volume').onChange((v: number) => solar.audio.setVolume(v));
    sound.add({ mute: () => solar.audio.toggleMute() }, 'mute').name('mute / unmute');
    sound
      .add(solar.audio, 'musicShare', 0, 1, 0.05)
      .name('music (x ship)')
      .onChange((v: number) => solar.audio.setMusicShare(v));
    const musicInfo = { source: solar.audio.musicSource as string };
    sound.add(musicInfo, 'source').name('music source').listen().disable();
    this.unsubscribers.push(bus.on('engine:frame', () => (musicInfo.source = solar.audio.musicSource)));
    sound.close();

    const inputFolder = this.gui.addFolder('Input');
    inputFolder.add(input, 'mouseSensitivity', 0.0002, 0.01, 0.0001).name('mouse sens.');
    inputFolder.add(input, 'invertMouseY').name('invert Y');

    // Day 5: keep the panel short so it clears the HUD radar (bottom right).
    camera.close();
    flight.close();
    inputFolder.close();

    const assets = this.gui.addFolder('Assets');
    assets.add(this.readouts, 'skyMode').name('sky').listen().disable();
    assets.add(this.readouts, 'shipModel').name('ship').listen().disable();
    assets.close();

    this.unsubscribers.push(
      bus.on('ship:telemetry', ({ speed, position, boosting }) => {
        this.readouts.speed = Math.round(speed * 10) / 10;
        this.readouts.position = `${position.x.toFixed(0)}, ${position.y.toFixed(0)}, ${position.z.toFixed(0)}`;
        this.readouts.boosting = boosting;
      }),
      bus.on('ship:collision', ({ bodyId, impactSpeed, damage, hull }) => {
        this.readouts.hull = Math.round(hull);
        this.readouts.lastImpact = `${bodyId} @ ${impactSpeed.toFixed(0)} u/s, -${damage.toFixed(0)}`;
      }),
      bus.on('ship:destroyed', ({ bodyId }) => {
        this.readouts.lastImpact = `destroyed by ${bodyId}, respawned`;
        this.readouts.hull = 100;
      }),
      bus.on('engine:frame', ({ fps }) => {
        this.readouts.fps = Math.round(fps);
        const info = engine.renderer.info.render;
        this.readouts.drawCalls = info.calls;
        this.readouts.triangles = `${(info.triangles / 1000).toFixed(1)}k`;
        this.readouts.simTime = `${system.simulationTime.toFixed(0)} s`;
        this.readouts.lod = system.describeNearestLod();
      }),
      bus.on('input:pointerlock', ({ locked }) => {
        this.readouts.mouseFlight = locked;
      }),
    );
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.gui.destroy();
    this.stats.dom.remove();
  }
}
