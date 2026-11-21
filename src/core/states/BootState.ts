// Unit II: event-driven flow. The Boot state gives asset loading a home and a
// visible progress indicator (SYSTEM_DESIGN.md section 5).
//
// Boot deliberately does NOT transition to the next state itself. A state that
// calls machine.change() from inside its own enter() re-enters the machine while
// the first transition is still in flight, which the machine rejects. main.ts
// owns the sequence instead: change('Boot') -> preload() -> change('Space').

import type * as THREE from 'three';
import type { EventBus } from '../EventBus';
import type { GameState } from '../StateMachine';

export class BootState implements GameState {
  readonly name = 'Boot' as const;

  private unsubscribe: (() => void) | null = null;

  constructor(private readonly bus: EventBus) {}

  enter(): void {
    const status = document.getElementById('boot-status');
    this.unsubscribe = this.bus.on('assets:progress', ({ loaded, total }) => {
      if (status) status.textContent = `Loading ${loaded}/${total}…`;
    });
  }

  /**
   * Everything that must exist before the first scene is built. Day 1 has
   * nothing to preload (the ship and skybox load inside SpaceScene, each with a
   * fallback). Day 2 needs nothing either: planets.json is bundled and the
   * planet surfaces are procedural shaders, not textures.
   */
  async preload(): Promise<void> {
    await Promise.resolve();
  }

  update(): void {
    /* nothing to simulate while loading */
  }

  render(_alpha: number, _renderer: THREE.WebGLRenderer): void {
    /* the boot screen is HTML; there is no scene to draw yet */
  }

  exit(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    document.getElementById('boot-message')?.setAttribute('hidden', '');
    document.getElementById('controls-hint')?.removeAttribute('hidden');
  }
}
