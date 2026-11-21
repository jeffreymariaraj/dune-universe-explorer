// Day 10. Unit II: menus, and logical input devices made visible.
//
// The HTML half of the title screen (the 3D half is core/states/MenuState.ts):
// the game's name, a Launch button, and the remappable CONTROLS menu. Every
// row is one physical key bound to one logical action; "Rebind" asks the
// InputManager to capture the next key press, then moves the binding to it.
// The game code never notices: it only ever asks for actions.
//
// Shown only while the state machine is in Menu.

import type { EventBus } from '../core/EventBus';
import type { Binding, InputManager } from '../core/InputManager';

const ACTION_LABELS: Record<string, string> = {
  'thrust:1': 'Thrust / walk forward',
  'thrust:-1': 'Reverse',
  'yaw:1': 'Turn left',
  'yaw:-1': 'Turn right',
  'pitch:1': 'Nose up / look up',
  'pitch:-1': 'Nose down / look down',
  'roll:1': 'Roll left',
  'roll:-1': 'Roll right',
  brake: 'Brake / jump',
  boost: 'Boost / run',
  toggleXRay: 'X-Ray panel',
  openMentat: 'Mentat',
  land: 'Land / return to orbit',
  toggleMap: 'System map',
  start: 'Launch (menu)',
};

function labelFor(binding: Binding): string {
  const key = binding.kind === 'axis' ? `${binding.action}:${binding.value}` : binding.action;
  return ACTION_LABELS[key] ?? key;
}

/** "KeyW" -> "W", "ArrowUp" -> "Up", "ShiftLeft" -> "Shift L". */
function keyName(code: string): string {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Arrow/, '')
    .replace(/Left$/, ' L')
    .replace(/Right$/, ' R');
}

export class TitleScreen {
  private readonly root: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly list: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly unsubscribe: () => void;

  constructor(
    parent: HTMLElement,
    private readonly bus: EventBus,
    private readonly input: InputManager,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'title-screen';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="title-block">
        <div class="title-kicker">CS373IA &middot; Computer Graphics &amp; VR</div>
        <h1 class="title-name">Known Universe<br/>Explorer</h1>
        <p class="title-sub">Fly the Known Universe. Land on its worlds. Ask your Mentat.</p>
        <div class="title-buttons">
          <button type="button" data-launch class="title-primary">Launch <span>Enter</span></button>
          <button type="button" data-controls>Controls</button>
        </div>
      </div>
      <div class="title-controls" data-panel hidden>
        <div class="title-controls-head">Controls <span>click a row, then press a key</span></div>
        <div class="title-controls-list" data-list></div>
        <div class="title-controls-foot">
          <span data-hint></span>
          <button type="button" data-reset>Reset to defaults</button>
        </div>
      </div>
    `;
    parent.appendChild(this.root);
    this.controls = this.root.querySelector('[data-panel]')!;
    this.list = this.root.querySelector('[data-list]')!;
    this.hint = this.root.querySelector('[data-hint]')!;

    this.root.querySelector('[data-launch]')!.addEventListener('click', () => {
      this.bus.emit('state:request', { to: 'Space' });
    });
    this.root.querySelector('[data-controls]')!.addEventListener('click', () => {
      this.controls.hidden = !this.controls.hidden;
      this.renderBindings();
    });
    this.root.querySelector('[data-reset]')!.addEventListener('click', () => {
      this.input.resetBindings();
      this.hint.textContent = 'Defaults restored.';
      this.renderBindings();
    });

    this.unsubscribe = bus.on('state:changed', ({ to }) => {
      this.root.hidden = to !== 'Menu';
      document.body.classList.toggle('in-menu', to === 'Menu');
    });
  }

  private renderBindings(): void {
    const bindings = Object.entries(this.input.getBindings()).sort(([, a], [, b]) => labelFor(a).localeCompare(labelFor(b)));
    this.list.replaceChildren();
    for (const [code, binding] of bindings) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'title-binding';
      const action = document.createElement('span');
      action.textContent = labelFor(binding);
      const key = document.createElement('kbd');
      key.textContent = keyName(code);
      row.append(action, key);
      row.addEventListener('click', () => this.rebind(code, binding, row));
      this.list.appendChild(row);
    }
  }

  /** Unit II: the next key press becomes this action's key. */
  private rebind(oldCode: string, binding: Binding, row: HTMLElement): void {
    row.classList.add('title-binding-waiting');
    this.hint.textContent = `Press a key for "${labelFor(binding)}" (Esc cancels)`;
    this.input.captureNextKey((code) => {
      row.classList.remove('title-binding-waiting');
      if (!code) {
        this.hint.textContent = 'Cancelled.';
      } else if (code !== oldCode) {
        const displaced = this.input.getBindings()[code];
        this.input.clearBinding(oldCode);
        this.input.rebind(code, binding);
        this.hint.textContent = displaced
          ? `${keyName(code)} now does "${labelFor(binding)}" (it was "${labelFor(displaced)}").`
          : `${keyName(code)} now does "${labelFor(binding)}".`;
      }
      this.renderBindings();
    });
  }

  dispose(): void {
    this.unsubscribe();
    this.root.remove();
  }
}
