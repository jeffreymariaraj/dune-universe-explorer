// Unit II: event-driven control flow. Unit V: scene lifecycle.
// Boot -> Menu -> Space <-> Warp <-> Surface, as in SYSTEM_DESIGN.md section 5.
// Each state owns its own scene graph and disposes it on exit, so only one
// heavy scene is resident at a time.

import type * as THREE from 'three';
import type { EventBus } from './EventBus';

export type GameStateName = 'Boot' | 'Menu' | 'Space' | 'Warp' | 'Surface';

/**
 * A state is a self-contained scene plus its update/render behaviour.
 * `update` runs on the fixed physics step; `render` runs once per frame with an
 * interpolation factor and is the only place allowed to touch the renderer.
 */
export interface GameState {
  readonly name: GameStateName;
  /** Build the scene graph and load assets. */
  enter(payload?: unknown): Promise<void> | void;
  /** Dispose geometries, materials, textures and listeners. */
  exit(): Promise<void> | void;
  /** Fixed timestep, always dt = 1/120 s. No rendering here. */
  update(dt: number): void;
  /**
   * Variable timestep. `alpha` is how far we are between the previous and the
   * current physics state (0..1); use it to interpolate transforms, then draw.
   */
  render(alpha: number, renderer: THREE.WebGLRenderer): void;
  /** Respond to a canvas resize (camera aspect, composer size). */
  resize?(width: number, height: number): void;
}

/** Legal transitions. Anything else is a bug and throws loudly in dev. */
const TRANSITIONS: Readonly<Record<GameStateName, readonly GameStateName[]>> = {
  Boot: ['Menu', 'Space'],
  Menu: ['Space'],
  Space: ['Warp', 'Menu'],
  Warp: ['Surface', 'Space'],
  Surface: ['Warp', 'Menu'],
};

export class StateMachine {
  private readonly states = new Map<GameStateName, GameState>();
  private current: GameState | null = null;
  private transitioning = false;

  constructor(private readonly bus: EventBus) {}

  register(state: GameState): void {
    this.states.set(state.name, state);
  }

  get currentName(): GameStateName | null {
    return this.current?.name ?? null;
  }

  get currentState(): GameState | null {
    return this.current;
  }

  canChangeTo(name: GameStateName): boolean {
    if (!this.current) return true;
    return TRANSITIONS[this.current.name].includes(name);
  }

  /**
   * Swap states: exit the old one (disposing its scene), then enter the new one.
   * Awaitable because `enter` may load assets.
   */
  async change(name: GameStateName, payload?: unknown): Promise<void> {
    const next = this.states.get(name);
    if (!next) throw new Error(`StateMachine: state "${name}" is not registered`);
    if (this.transitioning) {
      console.warn(`StateMachine: ignoring change to "${name}" mid-transition`);
      return;
    }
    if (!this.canChangeTo(name)) {
      throw new Error(`StateMachine: illegal transition ${this.current?.name} -> ${name}`);
    }

    this.transitioning = true;
    const from = this.current?.name ?? null;
    try {
      if (this.current) await this.current.exit();
      this.current = null; // nothing updates while we build the next scene
      await next.enter(payload);
      this.current = next;
      this.bus.emit('state:changed', { from, to: name });
    } finally {
      this.transitioning = false;
    }
  }

  /** Fixed step. Silently idle while a transition is in flight. */
  update(dt: number): void {
    this.current?.update(dt);
  }

  render(alpha: number, renderer: THREE.WebGLRenderer): void {
    this.current?.render(alpha, renderer);
  }

  resize(width: number, height: number): void {
    this.current?.resize?.(width, height);
  }

  async disposeAll(): Promise<void> {
    if (this.current) await this.current.exit();
    this.current = null;
    this.states.clear();
  }
}
