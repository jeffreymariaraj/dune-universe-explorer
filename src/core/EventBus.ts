// Unit V: object hierarchies / decoupled systems.
// A tiny typed publish-subscribe bus. Systems (ship, HUD, X-Ray, Mentat) talk
// through this and never import each other's internals, so any one of them can
// be swapped or tested in isolation.

import type { GameStateName } from './StateMachine';
import type { ActionName } from './InputManager';

/** The full set of messages that can travel on the bus. */
export interface GameEvents {
  /** Canvas was resized; payload is the new drawing-buffer size in CSS pixels. */
  'engine:resize': { width: number; height: number };
  /** Emitted once per rendered frame with the real (unclamped) frame time. */
  'engine:frame': { frameTime: number; fps: number };

  /** Asset loading progress, used by the Boot screen. */
  'assets:progress': { loaded: number; total: number; url: string };
  'assets:error': { url: string; reason: string };

  /** A state transition completed. */
  'state:changed': { from: GameStateName | null; to: GameStateName };
  /**
   * A state asks to hand over to another (Unit II: event-driven control flow).
   * States never call the machine themselves; main.ts performs the change
   * between frames, after the current update has finished.
   */
  'state:request': { to: GameStateName; payload?: unknown };

  /** Fade the whole screen to black (opacity 1) or back (0) over `seconds`. */
  'screen:fade': { opacity: number; seconds: number };
  /** The surface scene is ready (Day 7): for the HUD banner. */
  'surface:entered': { planetName: string; biome: string; daylight: boolean };
  /** On foot, 10 Hz (Day 8): movement mode, local gravity, nearest landmark. */
  'surface:status': {
    mode: 'walking' | 'running' | 'swimming' | 'airborne';
    gravity: number;
    poiName: string | null;
    poiDistance: number;
    /** Radians, 0 = ahead, positive = to the right. */
    poiBearing: number;
  };
  /** Walked up to a landmark (Day 8): the lore card shows it. */
  'poi:approach': { name: string; kind: string; description: string };
  'poi:leave': Record<string, never>;

  /** Trigger-mode input (Unit II: measure and trigger). */
  'input:trigger': { action: ActionName };
  /** Pointer lock was gained or lost (Unit II: input modes). */
  'input:pointerlock': { locked: boolean };

  /** Throttled ship telemetry for the HUD and the debug panel. */
  'ship:telemetry': {
    speed: number;
    position: { x: number; y: number; z: number };
    boosting: boolean;
    hull: number;
    /** Forward thrust 0..1 (engine sound, Day 10). */
    throttle: number;
  };

  /**
   * The ship hit something (Unit V: collision response). Emitted once per
   * impact, not per step of resting contact.
   */
  'ship:collision': {
    /** planets.json id, 'asteroid', or the star's id. */
    bodyId: string;
    impactSpeed: number;
    damage: number;
    hull: number;
  };
  /** Hull reached zero. The space scene respawns the ship. */
  'ship:destroyed': { bodyId: string };

  /**
   * Navigation fix for the HUD, radar and lore card, published at 10 Hz.
   * Radar blips are in the ship's HEADING frame, top-down: +x is right of the
   * nose, -z is straight ahead (world units). The HUD maps them to pixels.
   */
  'nav:update': {
    nearestId: string;
    nearestName: string;
    /** Distance to the nearest body's surface, world units. */
    altitude: number;
    nearestRadius: number;
    /** Planet whose sphere of influence the ship is in, or null. */
    dominantName: string | null;
    /** Gravity felt by the ship, world units / s^2. */
    gravity: number;
    /** Where the predicted path ends, if it hits something. */
    impactName: string | null;
    /** Planet under the reticle that L would land on (Day 7), or null. */
    landingTarget: string | null;
    blips: Array<{ id: string; name: string; kind: 'star' | 'planet' | 'blackhole'; x: number; z: number; radius: number }>;
  };

  /** X-Ray debug mode toggled (Unit I / IV: pipeline visualisation). */
  'xray:toggle': { enabled: boolean };
  /** Mentat chat panel opened or closed. */
  'mentat:toggle': { open: boolean };
  /**
   * Day 9: the Mentat's agent asked for a teleport (validated against
   * planets.json by the proxy). The active scene decides how to get there.
   */
  'mentat:teleport': { bodyId: string; poiId: string | null };
}

export type EventName = keyof GameEvents;
export type Listener<K extends EventName> = (payload: GameEvents[K]) => void;

export class EventBus {
  private readonly listeners = new Map<EventName, Set<Listener<EventName>>>();

  /** Subscribe. Returns an unsubscribe function so callers cannot leak. */
  on<K extends EventName>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<EventName>);
    return () => this.off(event, listener);
  }

  /** Subscribe for exactly one delivery. */
  once<K extends EventName>(event: K, listener: Listener<K>): () => void {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  off<K extends EventName>(event: K, listener: Listener<K>): void {
    this.listeners.get(event)?.delete(listener as Listener<EventName>);
  }

  emit<K extends EventName>(event: K, payload: GameEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Copy first: a listener may unsubscribe itself while we iterate.
    for (const listener of [...set]) {
      (listener as Listener<K>)(payload);
    }
  }

  /** Drop every listener. Called when a scene unloads. */
  clear(event?: EventName): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }

  listenerCount(event: EventName): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
