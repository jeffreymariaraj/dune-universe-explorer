// Day 7. Unit I: line primitives and post-processing; Unit II: event-driven
// control flow.
//
// The 1.5 s transition between Space and Surface (SYSTEM_DESIGN.md section 5):
// star streaks rush past a fixed camera, accelerating; chromatic aberration
// builds towards the edges of the screen; the last part fades to black. When it
// is over the state asks, on the EventBus, to hand over to Surface (going down)
// or Space (going up). The heavy surface generation then happens behind the
// black frame, in SurfaceScene.enter(), and that scene fades itself back in.
//
// The streaks are one LineSegments draw call: 1,200 segments in a tunnel
// around the view axis, each 2 vertices rewritten every fixed step. Going down
// they are tinted with the planet's atmosphere colour; going up, star white.

import * as THREE from 'three';
import { loadSystemData } from '../../data/systemData';
import { PostFX } from '../../render/PostFX';
import type { WarpPayload } from '../../surface/SurfaceScene';
import type { EventBus } from '../EventBus';
import type { GameState } from '../StateMachine';

const STREAKS = 1200;
const TUNNEL_LENGTH = 2400;
/** When the fade to black starts, seconds into the warp. */
const FADE_AT = 1.05;

export class WarpState implements GameState {
  readonly name = 'Warp' as const;

  /** Seconds the transition lasts. */
  static readonly DURATION = 1.5;

  private elapsed = 0;
  private payload: WarpPayload | null = null;
  private requested = false;
  private fading = false;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, 1, 0.5, 5000);
  private streaks: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  private positions: Float32Array | null = null;
  /** Per streak: x, y, z of its head. */
  private heads: Float32Array | null = null;
  private postFX: PostFX | null = null;
  private speed = 0;

  constructor(
    private readonly bus: EventBus,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.scene.name = 'WarpScene';
  }

  enter(payload?: unknown): void {
    const warp = payload as WarpPayload | undefined;
    if (!warp) throw new Error('WarpState: entered without a payload');
    this.payload = warp;
    this.elapsed = 0;
    this.requested = false;
    this.fading = false;
    this.speed = 300;

    const tint = new THREE.Color('#cfe3ff');
    if (warp.direction === 'down') {
      const planet = loadSystemData().bodies.find((b) => b.id === warp.landing.planetId);
      if (planet?.type === 'planet') tint.set(planet.generation.atmosphere.color).lerp(new THREE.Color('#ffffff'), 0.35);
    }

    // Streak heads scattered through a tunnel around the -Z axis.
    this.heads = new Float32Array(STREAKS * 3);
    this.positions = new Float32Array(STREAKS * 6);
    const colors = new Float32Array(STREAKS * 6);
    for (let i = 0; i < STREAKS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 30 + Math.random() * 260;
      this.heads[i * 3 + 0] = Math.cos(angle) * radius;
      this.heads[i * 3 + 1] = Math.sin(angle) * radius;
      this.heads[i * 3 + 2] = -Math.random() * TUNNEL_LENGTH;
      // Bright head, dark tail: additive blending fades the tail out.
      colors.set([tint.r * 1.6, tint.g * 1.6, tint.b * 1.6, 0, 0, 0], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.streaks = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.streaks.frustumCulled = false;
    this.scene.add(this.streaks);
    this.scene.background = new THREE.Color('#020308');
    this.writeSegments();

    const size = this.renderer.getSize(new THREE.Vector2());
    this.resize(size.x, size.y);
    this.postFX = new PostFX(this.renderer, this.scene, this.camera, { aberration: true });
    this.postFX.setSize(size.x, size.y);
    this.bus.emit('screen:fade', { opacity: 0, seconds: 0.25 });
  }

  update(dt: number): void {
    if (!this.payload || !this.heads) return;
    this.elapsed += dt;
    const t = Math.min(this.elapsed / WarpState.DURATION, 1);
    // Accelerate hard: 300 u/s -> ~9,000 u/s.
    this.speed = 300 + 8700 * t * t;

    for (let i = 0; i < STREAKS; i++) {
      let z = this.heads[i * 3 + 2]! + this.speed * dt;
      if (z > 0) z -= TUNNEL_LENGTH; // wrap: streaks are recycled
      this.heads[i * 3 + 2] = z;
    }
    this.writeSegments();

    if (!this.fading && this.elapsed >= FADE_AT) {
      this.fading = true;
      this.bus.emit('screen:fade', { opacity: 1, seconds: WarpState.DURATION - FADE_AT });
    }
    if (!this.requested && this.elapsed >= WarpState.DURATION) {
      this.requested = true;
      const { direction, landing } = this.payload;
      if (direction === 'down') this.bus.emit('state:request', { to: 'Surface', payload: landing });
      else {
        const back: { returnFrom: typeof landing; destination?: string } = { returnFrom: landing };
        if (this.payload.destination) back.destination = this.payload.destination;
        this.bus.emit('state:request', { to: 'Space', payload: back });
      }
    }
  }

  render(_alpha: number, _renderer: THREE.WebGLRenderer): void {
    if (!this.postFX) return;
    const t = Math.min(this.elapsed / WarpState.DURATION, 1);
    this.postFX.setAberration(t * t);
    this.camera.fov = 75 + 25 * t; // the view widens as the jump builds
    this.camera.updateProjectionMatrix();
    this.postFX.render(1 / 60);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.postFX?.setSize(width, height);
  }

  exit(): void {
    this.elapsed = 0;
    this.payload = null;
    if (this.streaks) {
      this.streaks.geometry.dispose();
      this.streaks.material.dispose();
      this.streaks = null;
    }
    this.heads = null;
    this.positions = null;
    this.postFX?.dispose();
    this.postFX = null;
    this.scene.clear();
  }

  /** Each streak runs from its head back along +Z by a length that grows with speed. */
  private writeSegments(): void {
    if (!this.heads || !this.positions || !this.streaks) return;
    const length = 4 + this.speed * 0.045;
    for (let i = 0; i < STREAKS; i++) {
      const x = this.heads[i * 3]!;
      const y = this.heads[i * 3 + 1]!;
      const z = this.heads[i * 3 + 2]!;
      this.positions.set([x, y, z, x, y, z - length], i * 6);
    }
    this.streaks.geometry.getAttribute('position').needsUpdate = true;
  }
}
