// Unit I: the graphics pipeline entry point (WebGL2 context + draw submission).
// Unit V: physical modelling needs a stable integrator, so simulation runs on a
// fixed timestep while rendering runs as fast as the display allows.
//
// Loop shape (SYSTEM_DESIGN.md section 5):
//   accumulator += frameTime
//   while (accumulator >= 1/120) { simulation.update(1/120); accumulator -= 1/120 }
//   simulation.render(accumulator / (1/120))   <- alpha interpolates the leftover
//
// Physics therefore behaves identically at 30, 60 or 144 fps, and rendering
// never stutters because it interpolates between the last two physics states.

import * as THREE from 'three';
import type { EventBus } from './EventBus';

/** Anything the engine can drive. `StateMachine` satisfies this structurally. */
export interface Simulation {
  update(dt: number): void;
  render(alpha: number, renderer: THREE.WebGLRenderer): void;
  resize?(width: number, height: number): void;
}

export interface EngineOptions {
  /** Hard cap on device pixel ratio; 2 is plenty on a Retina display. */
  maxPixelRatio?: number;
}

export class Engine {
  /** The one true physics step: 1/120 s. Never change this at runtime. */
  static readonly FIXED_DELTA = 1 / 120;
  /** Longest frame we are willing to simulate (avoids the "spiral of death"). */
  private static readonly MAX_FRAME_TIME = 1 / 10;
  private static readonly MAX_STEPS = 12;

  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  /** Called just before / after each frame; used by Stats. */
  onBeforeFrame: (() => void) | null = null;
  onAfterFrame: (() => void) | null = null;

  private simulation: Simulation | null = null;
  private readonly clock = new THREE.Clock(false);
  private accumulator = 0;
  private rafHandle = 0;
  private running = false;
  private smoothedFps = 60;
  private resizeObserver: ResizeObserver | null = null;
  private maxPixelRatioValue: number;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly bus: EventBus,
    options: EngineOptions = {},
  ) {
    this.canvas = canvas;
    // Day 10 perf pass: 1.5, not 2. With bloom, MSAA and lensing every extra
    // pixel costs a full post-processing chain; measured at 2048x1536 the
    // spawn view took ~12 ms, so a full-screen Retina window at 2x would miss
    // 60 fps. The debug panel can raise it again.
    this.maxPixelRatioValue = options.maxPixelRatio ?? 1.5;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // Needed later so the lensing pass can read the colour buffer.
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatioValue));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // Day 10 perf pass: post-processing draws in several passes, and three's
    // per-render counters would only show the last one. Count the whole frame.
    this.renderer.info.autoReset = false;

    this.handleResize = this.handleResize.bind(this);
    this.tick = this.tick.bind(this);
    this.handleContextLost = this.handleContextLost.bind(this);
    this.handleContextRestored = this.handleContextRestored.bind(this);

    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    this.observeSize();
    this.handleResize();
  }

  setSimulation(simulation: Simulation): void {
    this.simulation = simulation;
    const size = this.renderer.getSize(new THREE.Vector2());
    simulation.resize?.(size.x, size.y);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.accumulator = 0;
    this.clock.start();
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    this.clock.stop();
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
  }

  /** Highest device pixel ratio rendered at (render scale). Changing it resizes the buffers. */
  get maxPixelRatio(): number {
    return this.maxPixelRatioValue;
  }

  set maxPixelRatio(value: number) {
    this.maxPixelRatioValue = value;
    this.handleResize();
  }

    get fps(): number {
    return this.smoothedFps;
  }

  /** Seconds since start(), used for shader time uniforms. */
  get elapsed(): number {
    return this.clock.elapsedTime;
  }

  private tick(): void {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.tick);
    this.onBeforeFrame?.();

    const rawFrameTime = this.clock.getDelta();
    const frameTime = Math.min(rawFrameTime, Engine.MAX_FRAME_TIME);
    if (rawFrameTime > 0) {
      // Exponential smoothing so the readout is readable.
      this.smoothedFps += (1 / rawFrameTime - this.smoothedFps) * 0.1;
    }

    this.renderer.info.reset();
    const simulation = this.simulation;
    if (simulation) {
      this.accumulator += frameTime;

      let steps = 0;
      while (this.accumulator >= Engine.FIXED_DELTA && steps < Engine.MAX_STEPS) {
        simulation.update(Engine.FIXED_DELTA);
        this.accumulator -= Engine.FIXED_DELTA;
        steps++;
      }
      if (steps === Engine.MAX_STEPS) {
        // We are behind beyond recovery; drop the backlog instead of lagging.
        this.accumulator = 0;
      }

      const alpha = this.accumulator / Engine.FIXED_DELTA;
      simulation.render(alpha, this.renderer);
    }

    this.bus.emit('engine:frame', { frameTime: rawFrameTime, fps: this.smoothedFps });
    this.onAfterFrame?.();
  }

  // Unit IV: viewing pipeline. The drawing buffer must track the CSS size of the
  // canvas, and every camera's aspect ratio must follow it.
  private observeSize(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.canvas);
    } else {
      window.addEventListener('resize', this.handleResize);
    }
  }

  private handleResize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatioValue));
    this.renderer.setSize(width, height, false);
    this.simulation?.resize?.(width, height);
    this.bus.emit('engine:resize', { width, height });
  }

  private handleContextLost(event: Event): void {
    event.preventDefault();
    this.stop();
    console.warn('Engine: WebGL context lost; simulation paused.');
  }

  private handleContextRestored(): void {
    console.warn('Engine: WebGL context restored; resuming.');
    this.start();
  }

  dispose(): void {
    this.stop();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
  }
}
