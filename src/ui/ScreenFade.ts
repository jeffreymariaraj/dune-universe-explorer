// Day 7. A full-screen black layer for the Warp transition, driven only by
// 'screen:fade' on the EventBus: Warp fades to black while the surface is
// generated, and whichever scene comes next fades itself back in. A CSS
// transition does the animation, so the WebGL frame time is untouched.

import type { EventBus } from '../core/EventBus';

export class ScreenFade {
  private readonly root: HTMLDivElement;
  private readonly unsubscribe: () => void;

  constructor(parent: HTMLElement, bus: EventBus) {
    this.root = document.createElement('div');
    this.root.className = 'screen-fade';
    parent.appendChild(this.root);
    this.unsubscribe = bus.on('screen:fade', ({ opacity, seconds }) => {
      this.root.style.transitionDuration = `${Math.max(0, seconds)}s`;
      this.root.style.opacity = String(Math.max(0, Math.min(1, opacity)));
      // An instant cut must reach the screen before a following fade starts,
      // so force the style to apply now (reading layout flushes it).
      if (seconds <= 0) void this.root.offsetWidth;
    });
  }

  dispose(): void {
    this.unsubscribe();
    this.root.remove();
  }
}
