// Unit II: logical input devices, measure and trigger, input modes, event-driven input.
//
// Physical devices (keyboard, mouse; gamepad later) are mapped to LOGICAL ACTIONS.
// Nothing else in the project may add a keydown/mousemove listener: gameplay code
// only ever asks this class for an action.
//
// Two input modes, exactly as in the syllabus:
//   * request / sample mode  -> getAxis('yaw'), isDown('boost')   (polled each step)
//   * event mode             -> 'input:trigger' on the EventBus   (edge triggered)
// Plus a pointer-lock mode that turns relative mouse motion into a flight stick.

import type { EventBus } from './EventBus';

/** Continuous actions, measured in [-1, 1]. */
export type AxisAction = 'thrust' | 'yaw' | 'pitch' | 'roll';
/** Held actions, measured as a boolean. */
export type ButtonAction = 'brake' | 'boost';
/** One-shot actions, delivered as events. */
/** `land` is context-sensitive: land on the targeted planet, or return to orbit. */
export type TriggerAction = 'toggleXRay' | 'openMentat' | 'land' | 'toggleMap' | 'start';
export type ActionName = AxisAction | ButtonAction | TriggerAction;

export type Binding =
  | { kind: 'axis'; action: AxisAction; value: number }
  | { kind: 'button'; action: ButtonAction }
  | { kind: 'trigger'; action: TriggerAction };

/** Keyed by KeyboardEvent.code so the layout is physical, not locale dependent. */
export type BindingMap = Record<string, Binding>;

export const DEFAULT_BINDINGS: Readonly<BindingMap> = {
  KeyW: { kind: 'axis', action: 'thrust', value: 1 },
  KeyS: { kind: 'axis', action: 'thrust', value: -1 },
  KeyA: { kind: 'axis', action: 'yaw', value: 1 },
  KeyD: { kind: 'axis', action: 'yaw', value: -1 },
  ArrowUp: { kind: 'axis', action: 'pitch', value: 1 },
  ArrowDown: { kind: 'axis', action: 'pitch', value: -1 },
  ArrowLeft: { kind: 'axis', action: 'yaw', value: 1 },
  ArrowRight: { kind: 'axis', action: 'yaw', value: -1 },
  KeyQ: { kind: 'axis', action: 'roll', value: 1 },
  KeyE: { kind: 'axis', action: 'roll', value: -1 },
  Space: { kind: 'button', action: 'brake' },
  ShiftLeft: { kind: 'button', action: 'boost' },
  ShiftRight: { kind: 'button', action: 'boost' },
  KeyX: { kind: 'trigger', action: 'toggleXRay' },
  KeyM: { kind: 'trigger', action: 'openMentat' },
  KeyL: { kind: 'trigger', action: 'land' },
  KeyO: { kind: 'trigger', action: 'toggleMap' },
  Enter: { kind: 'trigger', action: 'start' },
};

/** Keys the browser would otherwise use to scroll the page. */
const SWALLOWED_CODES = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface InputOptions {
  /** Radians of stick deflection per pixel of mouse motion. */
  mouseSensitivity?: number;
  invertMouseY?: boolean;
}

export class InputManager {
  /** Live, tweakable from the lil-gui panel. */
  mouseSensitivity: number;
  invertMouseY: boolean;

  private bindings: BindingMap = { ...DEFAULT_BINDINGS };
  private readonly held = new Set<string>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private pointerLocked = false;
  private enabled = true;
  private disposers: Array<() => void> = [];
  /** Day 10: the controls menu waits for one key to rebind (Unit II: menus). */
  private capture: ((code: string | null) => void) | null = null;

  constructor(
    private readonly target: HTMLElement,
    private readonly bus: EventBus,
    options: InputOptions = {},
  ) {
    this.mouseSensitivity = options.mouseSensitivity ?? 0.0022;
    this.invertMouseY = options.invertMouseY ?? false;
    this.attach();
  }

  // ---------------------------------------------------------------- request mode

  /** Measure a continuous action in [-1, 1]. Keyboard and mouse are summed. */
  getAxis(action: AxisAction): number {
    let value = 0;
    for (const code of this.held) {
      const binding = this.bindings[code];
      if (binding && binding.kind === 'axis' && binding.action === action) {
        value += binding.value;
      }
    }
    // Pointer-lock mouse flight feeds yaw and pitch.
    if (this.pointerLocked) {
      if (action === 'yaw') value -= this.mouseDeltaX * this.mouseSensitivity;
      if (action === 'pitch') {
        value -= this.mouseDeltaY * this.mouseSensitivity * (this.invertMouseY ? -1 : 1);
      }
    }
    return Math.max(-1, Math.min(1, value));
  }

  /** Measure a held action. */
  isDown(action: ButtonAction): boolean {
    for (const code of this.held) {
      const binding = this.bindings[code];
      if (binding && binding.kind === 'button' && binding.action === action) return true;
    }
    return false;
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /**
   * Call once per RENDERED frame, after all fixed updates. Mouse motion is a
   * per-frame delta: every substep in a frame must see the same value, and it
   * must not carry over into the next frame.
   */
  endFrame(): void {
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }

  // -------------------------------------------------------------- remapping (Unit II)

  getBindings(): Readonly<BindingMap> {
    return this.bindings;
  }

  /** Used by the controls menu. Replaces whatever that key was bound to. */
  rebind(code: string, binding: Binding): void {
    this.bindings[code] = binding;
  }

  clearBinding(code: string): void {
    delete this.bindings[code];
  }

  /**
   * Hand the next key press to `callback` instead of the game (Esc cancels
   * with null). This is how the controls menu rebinds a key without adding a
   * second keydown listener anywhere else in the project.
   */
  captureNextKey(callback: (code: string | null) => void): void {
    this.capture = callback;
  }

  resetBindings(): void {
    this.bindings = { ...DEFAULT_BINDINGS };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.held.clear();
  }

  requestPointerLock(): void {
    // Chrome returns a promise and rejects it if the lock is requested again too
    // soon after Esc. Swallow that: it is not an error we can act on.
    const result: unknown = this.target.requestPointerLock?.();
    if (result instanceof Promise) result.catch(() => undefined);
  }

  exitPointerLock(): void {
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  // ------------------------------------------------------------------ plumbing

  private attach(): void {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (this.capture) {
        event.preventDefault();
        const callback = this.capture;
        this.capture = null;
        callback(event.code === 'Escape' ? null : event.code);
        return;
      }
      if (!this.enabled || isTypingTarget(event.target)) return;
      const binding = this.bindings[event.code];
      if (!binding) return;
      if (SWALLOWED_CODES.has(event.code)) event.preventDefault();

      if (binding.kind === 'trigger') {
        // A game key, not text: stop the browser from also typing it into
        // whatever the trigger focuses (M opens the Mentat with focus in its box).
        event.preventDefault();
        // Event mode: fire on the edge only, ignore auto-repeat.
        if (!event.repeat) this.bus.emit('input:trigger', { action: binding.action });
        return;
      }
      this.held.add(event.code);
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      this.held.delete(event.code);
    };

    // Losing focus must not leave a key stuck down mid-burn.
    const onBlur = (): void => this.held.clear();

    const onMouseMove = (event: MouseEvent): void => {
      if (!this.enabled || !this.pointerLocked) return;
      this.mouseDeltaX += event.movementX;
      this.mouseDeltaY += event.movementY;
    };

    const onClick = (): void => {
      if (this.enabled && !this.pointerLocked) this.requestPointerLock();
    };

    const onPointerLockChange = (): void => {
      this.pointerLocked = document.pointerLockElement === this.target;
      this.mouseDeltaX = 0;
      this.mouseDeltaY = 0;
      this.bus.emit('input:pointerlock', { locked: this.pointerLocked });
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', onMouseMove);
    this.target.addEventListener('click', onClick);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    this.disposers = [
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => this.target.removeEventListener('click', onClick),
      () => document.removeEventListener('pointerlockchange', onPointerLockChange),
    ];
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.held.clear();
  }
}

/** Never steal keystrokes from the Mentat chat box. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}
