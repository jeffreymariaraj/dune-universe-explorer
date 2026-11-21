// Day 5. Slide-in card showing lore.title / lore.summary / lore.trivia for the
// body you are approaching, straight from planets.json (the same file the
// Mentat will answer from, so the two can never disagree).
//
// On foot (Day 8) the same card shows a landmark from the planet's
// pointsOfInterest when you walk up to it ('poi:approach' / 'poi:leave').
//
// Driven by 'nav:update' on the EventBus. Hysteresis stops it flickering on the
// boundary: the card opens inside SHOW_WITHIN radii of altitude and closes only
// beyond HIDE_BEYOND radii.
//
// All lore text is written by the team — never copied from the books, wikis or
// films (CLAUDE.md).

import type { EventBus } from '../core/EventBus';
import { loadSystemData, type BodyData } from '../data/systemData';

/** Open when altitude < SHOW_WITHIN * body radius; close beyond HIDE_BEYOND. */
const SHOW_WITHIN = 6;
const HIDE_BEYOND = 8;
/** Trivia lines still holding the planets.json template text are not shown. */
const PLACEHOLDER_TRIVIA = /^write your own/i;

export class LoreCard {
  private readonly root: HTMLElement;
  private readonly bodies = new Map<string, BodyData>();
  private readonly unsubscribe: () => void;
  private currentId: string | null = null;

  constructor(parent: HTMLElement, bus: EventBus) {
    for (const body of loadSystemData().bodies) this.bodies.set(body.id, body);

    this.root = document.createElement('aside');
    this.root.className = 'lore-card';
    this.root.setAttribute('aria-live', 'polite');
    parent.appendChild(this.root);

    const offState = bus.on('state:changed', () => {
      this.hide(); // a new scene starts with no card
    });
    const offNav = bus.on('nav:update', ({ nearestId, altitude, nearestRadius }) => {
      if (altitude < nearestRadius * SHOW_WITHIN) {
        if (this.currentId !== nearestId) this.show(nearestId);
      } else if (this.currentId !== null && (this.currentId !== nearestId || altitude > nearestRadius * HIDE_BEYOND)) {
        this.hide(); // flown away, or the card's body is no longer the nearest
      }
    });
    const offPoi = bus.on('poi:approach', ({ name, kind, description }) => {
      this.showCard('Point of interest', name, kind, description, []);
      this.currentId = `poi:${name}`;
    });
    const offPoiLeave = bus.on('poi:leave', () => this.hide());
    this.unsubscribe = () => {
      offState();
      offNav();
      offPoi();
      offPoiLeave();
    };
  }

  get shownBodyId(): string | null {
    return this.currentId;
  }

  show(bodyId: string): void {
    const body = this.bodies.get(bodyId);
    if (!body) return;
    this.currentId = bodyId;

    const trivia = body.lore.trivia.filter((line) => !PLACEHOLDER_TRIVIA.test(line.trim()));
    const kicker = body.type === 'star' ? 'Star' : body.type === 'planet' ? 'Planet' : 'Anomaly';
    this.showCard(kicker, body.name, body.lore.title, body.lore.summary, trivia);
  }

  private showCard(kicker: string, name: string, title: string, summary: string, trivia: string[]): void {
    this.root.replaceChildren();
    this.root.append(
      element('div', 'lore-kicker', kicker),
      element('h2', 'lore-name', name),
      element('div', 'lore-title', title),
      element('p', 'lore-summary', summary),
    );
    if (trivia.length > 0) {
      const list = element('ul', 'lore-trivia');
      for (const line of trivia) list.append(element('li', '', line));
      this.root.append(list);
    }
    this.root.classList.add('lore-open');
  }

  hide(): void {
    this.root.classList.remove('lore-open');
    this.currentId = null;
  }

  dispose(): void {
    this.unsubscribe();
    this.root.remove();
  }
}

/** textContent only: lore is data, never parsed as HTML. */
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
