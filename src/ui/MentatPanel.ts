// Day 9. The terminal-styled chat panel for the ship's Mentat, opened by the
// 'openMentat' logical action (M). Answers render word by word as they stream
// in; a validated teleport from the agent is carried out once the answer has
// finished, so the pilot reads the confirmation first.
//
// If the proxy is unreachable, has no key, or the model fails mid-answer, the
// panel answers from planets.json itself (mentat/offlineMentat.ts) — including
// teleports — so the demo never breaks.
//
// Its text input is the one place keystrokes are allowed to bypass the
// InputManager (which ignores text fields). While the panel is open the flight
// controls are held and mouse flight is released, so typing "w" never fires
// the engine. Enter sends; Esc or the close button closes.

import type { EventBus } from '../core/EventBus';
import type { InputManager } from '../core/InputManager';
import { loadSystemData, type BodyData } from '../data/systemData';
import { buildContext, type SceneSnapshot } from '../mentat/contextBuilder';
import { MentatClient, type MentatTurn } from '../mentat/MentatClient';
import { answerOffline } from '../mentat/offlineMentat';

/** Pause between the end of an answer and the teleport, so it can be read. */
const TELEPORT_DELAY_MS = 1200;
const HISTORY_TURNS = 4;

export class MentatPanel {
  private readonly root: HTMLElement;
  private readonly log: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly field: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly bodies: readonly BodyData[];
  private readonly client = new MentatClient();
  private readonly history: MentatTurn[] = [];
  private readonly unsubscribers: Array<() => void> = [];
  private readonly scene: SceneSnapshot = { state: 'Other', bodyId: null, altitude: null, nearestPoi: null, poiDistance: null };
  private open = false;
  private busy = false;
  private abort: AbortController | null = null;

  constructor(
    parent: HTMLElement,
    private readonly bus: EventBus,
    private readonly input: InputManager,
  ) {
    this.bodies = loadSystemData().bodies;

    this.root = document.createElement('section');
    this.root.className = 'mentat';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Mentat');
    this.root.innerHTML = `
      <header class="mentat-head">
        <span class="mentat-title">Mentat</span>
        <span class="mentat-status" data-status>ready</span>
        <button type="button" class="mentat-close" data-close aria-label="Close">&times;</button>
      </header>
      <div class="mentat-log" data-log aria-live="polite"></div>
      <form class="mentat-form" data-form>
        <span class="mentat-prompt">&gt;</span>
        <input class="mentat-input" data-input type="text" autocomplete="off" spellcheck="false"
          placeholder="Ask, or say: take me to the Thumper on Arrakis" />
      </form>
    `;
    parent.appendChild(this.root);
    this.log = this.root.querySelector('[data-log]')!;
    this.form = this.root.querySelector('[data-form]')!;
    this.field = this.root.querySelector('[data-input]')!;
    this.status = this.root.querySelector('[data-status]')!;

    this.form.addEventListener('submit', this.onSubmit);
    this.field.addEventListener('keydown', this.onFieldKey);
    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.setOpen(false));

    this.write('mentat', 'At your service, my lord. Ask about any world, where we can go, or what is worth seeing there.');

    // Unit II: the panel only learns about the game from the bus.
    this.unsubscribers.push(
      bus.on('input:trigger', ({ action }) => {
        if (action === 'openMentat') this.setOpen(!this.open);
      }),
      bus.on('state:changed', ({ to }) => {
        this.scene.state = to === 'Space' || to === 'Surface' || to === 'Warp' ? to : 'Other';
        if (to !== 'Surface') {
          this.scene.nearestPoi = null;
          this.scene.poiDistance = null;
        }
      }),
      bus.on('nav:update', ({ nearestId, altitude, nearestRadius }) => {
        this.scene.bodyId = nearestId;
        this.scene.altitude = altitude;
        this.scene.radius = nearestRadius;
      }),
      bus.on('surface:entered', ({ planetName }) => {
        this.scene.bodyId = this.bodies.find((b) => b.name === planetName)?.id ?? null;
        this.scene.altitude = null;
      }),
      bus.on('surface:status', ({ poiName, poiDistance }) => {
        this.scene.nearestPoi = poiName;
        this.scene.poiDistance = poiDistance;
      }),
    );
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.root.hidden = !open;
    document.body.classList.toggle('mentat-open', open);
    // Hold the flight controls while typing; give them back on close.
    this.input.setEnabled(!open);
    if (open) {
      this.input.exitPointerLock();
      // Focus after this key event has finished, so the M that opened the
      // panel can never land in the box.
      window.requestAnimationFrame(() => this.field.focus());
    } else {
      this.field.blur();
    }
    this.bus.emit('mentat:toggle', { open });
  }

  /** Ask a question (also used by tests and the dev console). */
  async ask(question: string): Promise<void> {
    const text = question.trim();
    if (!text || this.busy) return;
    this.busy = true;
    this.write('pilot', text);
    const reply = this.write('mentat', '');
    reply.classList.add('mentat-typing');
    this.setStatus('thinking');

    let answer = '';
    let pending: { bodyId: string; poiId: string | null } | null = null;
    let usedFallback = false;
    this.abort = new AbortController();

    await this.client.ask(
      { question: text, context: buildContext(this.scene, this.bodies), history: this.history.slice(-HISTORY_TURNS) },
      (event) => {
        switch (event.type) {
          case 'token':
            answer += event.text;
            // The panel shows plain text; drop stray markdown emphasis.
            reply.textContent = answer.replace(/\*\*|__/g, '');
            this.scrollToEnd();
            break;
          case 'tool':
            this.setStatus(event.name === 'teleport' ? 'plotting a jump' : 'consulting the archives');
            break;
          case 'action':
            pending = { bodyId: event.action.bodyId, poiId: event.action.poiId };
            this.note(`course set: ${event.action.poiName ? `${event.action.poiName}, ` : ''}${event.action.bodyName}`);
            break;
          case 'fallback': {
            // Answer from planets.json instead (keeps any text already shown).
            usedFallback = true;
            const offline = answerOffline(text, this.scene, this.bodies);
            answer = answer ? `${answer} ${offline.text}` : offline.text;
            reply.textContent = answer;
            if (offline.teleport && !pending) pending = offline.teleport;
            this.note(`offline archive (${event.reason})`);
            break;
          }
          case 'done':
            break;
        }
      },
      this.abort.signal,
    );

    reply.classList.remove('mentat-typing');
    this.abort = null;
    this.busy = false;
    this.setStatus(usedFallback ? 'offline' : 'ready');
    this.history.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
    this.history.splice(0, Math.max(0, this.history.length - HISTORY_TURNS * 2));

    const teleport: { bodyId: string; poiId: string | null } | null = pending;
    if (teleport) {
      window.setTimeout(() => {
        this.setOpen(false);
        this.bus.emit('mentat:teleport', teleport);
      }, TELEPORT_DELAY_MS);
    }
  }

  private readonly onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const question = this.field.value;
    this.field.value = '';
    void this.ask(question);
  };

  private readonly onFieldKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.setOpen(false);
    }
  };

  private write(who: 'pilot' | 'mentat', text: string): HTMLElement {
    const line = document.createElement('p');
    line.className = `mentat-line mentat-${who}`;
    line.textContent = text; // model output is text, never HTML
    this.log.appendChild(line);
    this.scrollToEnd();
    return line;
  }

  private note(text: string): void {
    const line = document.createElement('p');
    line.className = 'mentat-line mentat-note';
    line.textContent = `[${text}]`;
    this.log.appendChild(line);
    this.scrollToEnd();
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
  }

  private scrollToEnd(): void {
    this.log.scrollTop = this.log.scrollHeight;
  }

  dispose(): void {
    this.abort?.abort();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    if (this.open) this.setOpen(false);
    this.root.remove();
  }
}
