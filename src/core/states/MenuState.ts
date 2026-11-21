// Day 10. Unit II: menus as an input device; Unit V: appearance.
//
// The title screen: a slowly turning Arrakis (the real Day 3 planet — same
// shader, same planets.json data) over the starfield, with the HTML title and
// controls menu (ui/TitleScreen.ts) on top. Enter or "Launch" asks for Space.
//
// Like every state it owns its scene and disposes it on exit.

import * as THREE from 'three';
import { loadSystemData, type PlanetData } from '../../data/systemData';
import { PostFX } from '../../render/PostFX';
import { buildCubeSphere } from '../../space/CubeSphere';
import { Planet } from '../../space/Planet';
import { Skybox } from '../../space/Skybox';
import type { AssetLoader } from '../AssetLoader';
import type { EventBus } from '../EventBus';
import type { GameState } from '../StateMachine';

/** Backdrop planet spin, rad/s: one turn every ~4 minutes. */
const SPIN_RATE = 0.025;

export class MenuState implements GameState {
  readonly name = 'Menu' as const;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 1, 60_000);
  private skybox: Skybox | null = null;
  private planet: Planet | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private postFX: PostFX | null = null;
  private unsubscribe: (() => void) | null = null;
  private elapsed = 0;
  private spin = 0;
  private prevSpin = 0;

  constructor(
    private readonly bus: EventBus,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly assets: AssetLoader,
  ) {
    this.scene.name = 'MenuScene';
  }

  async enter(): Promise<void> {
    this.skybox = new Skybox(this.assets);
    await this.skybox.load(this.scene, this.renderer.getPixelRatio());

    const arrakis = loadSystemData().bodies.find((b): b is PlanetData => b.type === 'planet' && b.id === 'arrakis');
    if (!arrakis) throw new Error('MenuState: planets.json has no Arrakis');
    this.geometry = buildCubeSphere(56);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
    this.planet = new Planet(arrakis, [this.geometry], new THREE.Color('#fff1d6'));
    this.scene.add(this.planet.lod, this.planet.atmosphere.mesh);
    // Star off to the left and slightly behind: half day, half night, with the
    // terminator and the night-side rim glow in shot.
    this.planet.updateLighting(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-9000, 2500, -2500));

    // Planet sits right of centre so the title has room on the left.
    this.camera.position.set(-330, 60, 900);
    this.camera.lookAt(-190, 0, 0);

    const size = this.renderer.getSize(new THREE.Vector2());
    this.postFX = new PostFX(this.renderer, this.scene, this.camera, { lensing: false });
    this.resize(size.x, size.y);

    this.unsubscribe = this.bus.on('input:trigger', ({ action }) => {
      if (action === 'start') this.bus.emit('state:request', { to: 'Space' });
    });
    this.bus.emit('screen:fade', { opacity: 0, seconds: 1.2 });
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.prevSpin = this.spin;
    this.spin += SPIN_RATE * dt;
  }

  render(alpha: number, _renderer: THREE.WebGLRenderer): void {
    if (!this.planet || !this.postFX) return;
    this.planet.lod.rotation.y = this.prevSpin + (this.spin - this.prevSpin) * alpha;
    this.skybox?.update(this.elapsed, this.camera.position);
    this.postFX.render(1 / 60);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.postFX?.setSize(width, height);
    this.skybox?.setPixelRatio(this.renderer.getPixelRatio());
  }

  exit(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.skybox?.dispose(this.scene);
    this.skybox = null;
    this.planet?.dispose();
    this.planet = null;
    this.geometry?.dispose();
    this.geometry = null;
    this.postFX?.dispose();
    this.postFX = null;
    this.scene.clear();
  }
}
