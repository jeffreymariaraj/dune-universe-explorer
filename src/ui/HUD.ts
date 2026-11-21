// Day 5. Unit III: 2D viewing — window-to-viewport transform and clipping;
// lines and circles. Unit II: event-driven output.
//
// HTML/CSS overlay driven purely by EventBus messages ('ship:telemetry' at
// 20 Hz, 'nav:update' at 10 Hz, 'ship:collision'), so the HUD never reaches
// into the ship or the solar system. Shows speed, hull, nearest body and
// altitude, gravity, a predicted-impact warning, a centre reticle, and a radar.
//
// The radar is the syllabus's 2D viewing pipeline:
//   WINDOW   a square of world space around the ship, [-range, range]^2,
//            in the ship's heading frame (nose up)
//   VIEWPORT the SVG's pixel square, [0, size]^2
//   mapping  xv = (x + range) * size / (2 range),  yv = (z + range) * size / (2 range)
// Anything outside the circular window is CLIPPED: instead of disappearing it
// is pinned to the rim as a direction marker, so off-scale planets still show
// which way to fly.
//
// Day 7: a landing prompt when the reticle is on a planet in range, the flight
// HUD hidden outside Space, and a banner on the surface. Day 8: the banner
// shows movement mode, local gravity and a compass line to the nearest landmark.

import type { EventBus, GameEvents } from '../core/EventBus';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RADAR_SIZE = 168; // viewport, CSS pixels
const RADAR_RANGES = [1500, 6000, 24000] as const; // window half-widths, world units

type NavUpdate = GameEvents['nav:update'];

export class HUD {
  private readonly root: HTMLDivElement;
  private readonly speed: HTMLElement;
  private readonly hullBar: HTMLElement;
  private readonly hullValue: HTMLElement;
  private readonly nearest: HTMLElement;
  private readonly altitude: HTMLElement;
  private readonly gravity: HTMLElement;
  private readonly warning: HTMLElement;
  private readonly land: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly flightParts: HTMLElement[];
  private readonly radar: SVGSVGElement;
  private readonly radarBlips: SVGGElement;
  private readonly radarRangeLabel: SVGTextElement;
  private readonly unsubscribers: Array<() => void> = [];
  private rangeIndex = 1;
  private lastNav: NavUpdate | null = null;

  constructor(parent: HTMLElement, bus: EventBus) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-reticle" aria-hidden="true">
        <svg viewBox="-20 -20 40 40" width="40" height="40">
          <circle r="9" class="reticle-ring" />
          <line x1="-16" y1="0" x2="-11" y2="0" /><line x1="11" y1="0" x2="16" y2="0" />
          <line x1="0" y1="-16" x2="0" y2="-11" /><line x1="0" y1="11" x2="0" y2="16" />
        </svg>
      </div>
      <div class="hud-panel hud-flight">
        <div class="hud-row"><span class="hud-label">Speed</span><span class="hud-value" data-speed>0</span><span class="hud-unit">u/s</span></div>
        <div class="hud-row"><span class="hud-label">Hull</span>
          <span class="hud-bar"><span class="hud-bar-fill" data-hull-bar></span></span>
          <span class="hud-value hud-small" data-hull>100</span></div>
        <div class="hud-row"><span class="hud-label">Nearest</span><span class="hud-value hud-name" data-nearest>-</span></div>
        <div class="hud-row"><span class="hud-label">Altitude</span><span class="hud-value" data-altitude>-</span></div>
        <div class="hud-row"><span class="hud-label">Gravity</span><span class="hud-value hud-small" data-gravity>-</span></div>
        <div class="hud-warning" data-warning hidden></div>
        <div class="hud-land" data-land hidden></div>
      </div>
      <div class="hud-panel hud-surface" data-surface hidden></div>
      <div class="hud-panel hud-radar" title="Click to change range"></div>
    `;
    parent.appendChild(this.root);

    const get = (selector: string): HTMLElement => {
      const element = this.root.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`HUD: missing ${selector}`);
      return element;
    };
    this.speed = get('[data-speed]');
    this.hullBar = get('[data-hull-bar]');
    this.hullValue = get('[data-hull]');
    this.nearest = get('[data-nearest]');
    this.altitude = get('[data-altitude]');
    this.gravity = get('[data-gravity]');
    this.warning = get('[data-warning]');
    this.land = get('[data-land]');
    this.surface = get('[data-surface]');
    this.flightParts = [get('.hud-flight'), get('.hud-reticle')];

    // ----- radar (Unit III: circles, lines, window-to-viewport, clipping)
    const radarPanel = get('.hud-radar');
    this.radar = document.createElementNS(SVG_NS, 'svg');
    this.radar.setAttribute('width', String(RADAR_SIZE));
    this.radar.setAttribute('height', String(RADAR_SIZE));
    this.radar.setAttribute('viewBox', `0 0 ${RADAR_SIZE} ${RADAR_SIZE}`);
    const c = RADAR_SIZE / 2;
    this.radar.innerHTML = `
      <circle cx="${c}" cy="${c}" r="${c - 2}" class="radar-edge" />
      <circle cx="${c}" cy="${c}" r="${(c - 2) / 2}" class="radar-ring" />
      <line x1="${c}" y1="4" x2="${c}" y2="${RADAR_SIZE - 4}" class="radar-ring" />
      <line x1="4" y1="${c}" x2="${RADAR_SIZE - 4}" y2="${c}" class="radar-ring" />
      <polygon points="${c},${c - 6} ${c - 4},${c + 5} ${c + 4},${c + 5}" class="radar-ship" />
    `;
    this.radarBlips = document.createElementNS(SVG_NS, 'g');
    this.radar.appendChild(this.radarBlips);
    this.radarRangeLabel = document.createElementNS(SVG_NS, 'text');
    this.radarRangeLabel.setAttribute('x', '6');
    this.radarRangeLabel.setAttribute('y', String(RADAR_SIZE - 6));
    this.radarRangeLabel.setAttribute('class', 'radar-label');
    this.radar.appendChild(this.radarRangeLabel);
    radarPanel.appendChild(this.radar);
    // The overlay ignores the pointer; the radar opts back in so it can be clicked.
    radarPanel.addEventListener('click', this.cycleRange);
    this.updateRangeLabel();

    this.unsubscribers.push(
      bus.on('ship:telemetry', ({ speed, hull }) => {
        this.speed.textContent = speed.toFixed(0);
        this.setHull(hull);
      }),
      bus.on('ship:collision', ({ hull }) => {
        this.setHull(hull);
        this.root.classList.remove('hud-hit');
        void this.root.offsetWidth; // restart the flash animation
        this.root.classList.add('hud-hit');
      }),
      bus.on('nav:update', (nav) => this.onNav(nav)),
      bus.on('state:changed', ({ to }) => this.showFor(to)),
      bus.on('surface:entered', ({ planetName, daylight }) => {
        this.surface.replaceChildren();
        const title = document.createElement('strong');
        title.textContent = planetName;
        const hint = document.createElement('span');
        hint.textContent = `${daylight ? 'Day' : 'Night'} side \u00b7 W walk \u00b7 Shift run \u00b7 Space jump \u00b7 A/D turn \u00b7 \u2191/\u2193 look \u00b7 L return to orbit`;
        const status = document.createElement('span');
        status.className = 'hud-surface-status';
        this.surfaceStatus = status;
        this.surface.append(title, hint, status);
      }),
      bus.on('surface:status', ({ mode, gravity, poiName, poiDistance, poiBearing }) => {
        if (!this.surfaceStatus) return;
        const where = poiName ? ` \u00b7 ${compassArrow(poiBearing)} ${poiName} ${formatDistance(poiDistance)}` : '';
        this.surfaceStatus.textContent = `${mode} \u00b7 g ${gravity.toFixed(1)} u/s\u00b2${where}`;
      }),
    );
    this.radarPanel = radarPanel;
  }

  private readonly radarPanel: HTMLElement;
  private surfaceStatus: HTMLElement | null = null;

  /** Flight instruments only in Space; the surface banner only on the surface. */
  private showFor(state: string): void {
    const inSpace = state === 'Space';
    for (const part of this.flightParts) part.hidden = !inSpace;
    this.radarPanel.hidden = !inSpace;
    this.surface.hidden = state !== 'Surface';
  }

  private readonly cycleRange = (): void => {
    this.rangeIndex = (this.rangeIndex + 1) % RADAR_RANGES.length;
    this.updateRangeLabel();
    if (this.lastNav) this.drawRadar(this.lastNav);
  };

  private updateRangeLabel(): void {
    this.radarRangeLabel.textContent = `${formatDistance(RADAR_RANGES[this.rangeIndex]!)}`;
  }

  private setHull(hull: number): void {
    const fraction = Math.max(0, Math.min(1, hull / 100));
    this.hullBar.style.transform = `scaleX(${fraction})`;
    this.hullBar.dataset['level'] = fraction > 0.6 ? 'ok' : fraction > 0.3 ? 'warn' : 'bad';
    this.hullValue.textContent = hull.toFixed(0);
  }

  private onNav(nav: NavUpdate): void {
    this.lastNav = nav;
    this.nearest.textContent = nav.nearestName;
    this.altitude.textContent = formatDistance(Math.max(0, nav.altitude));
    this.gravity.textContent = `${nav.gravity.toFixed(1)} u/s²${nav.dominantName ? ` · ${nav.dominantName}` : ''}`;
    if (nav.impactName) {
      this.warning.hidden = false;
      this.warning.textContent = `Collision course: ${nav.impactName}`;
    } else {
      this.warning.hidden = true;
    }
    this.land.hidden = nav.landingTarget === null;
    if (nav.landingTarget) this.land.textContent = `L \u2014 land on ${nav.landingTarget}`;
    this.drawRadar(nav);
  }

  /** Unit III: map each blip from the world window to the radar viewport. */
  private drawRadar(nav: NavUpdate): void {
    const range = RADAR_RANGES[this.rangeIndex]!;
    const size = RADAR_SIZE;
    const centre = size / 2;
    const rimRadius = centre - 6;
    const scale = size / (2 * range); // world units -> pixels

    const fragments: string[] = [];
    for (const blip of nav.blips) {
      // Window-to-viewport: shift by the window origin, scale to the viewport.
      let xv = (blip.x + range) * scale;
      let yv = (blip.z + range) * scale;

      // Clip against the circular window: pin outside points to the rim.
      const dx = xv - centre;
      const dy = yv - centre;
      const distance = Math.hypot(dx, dy);
      const clipped = distance > rimRadius;
      if (clipped) {
        xv = centre + (dx / distance) * rimRadius;
        yv = centre + (dy / distance) * rimRadius;
      }

      const r = clipped ? 2.5 : Math.max(2.5, blip.radius * scale);
      const cls = `radar-blip radar-${blip.kind}${clipped ? ' radar-clipped' : ''}${blip.id === nav.nearestId ? ' radar-nearest' : ''}`;
      fragments.push(`<circle cx="${xv.toFixed(1)}" cy="${yv.toFixed(1)}" r="${r.toFixed(1)}" class="${cls}" />`);
      if (!clipped) {
        fragments.push(
          `<text x="${(xv + r + 3).toFixed(1)}" y="${(yv + 3).toFixed(1)}" class="radar-text">${escapeText(blip.name)}</text>`,
        );
      }
    }
    this.radarBlips.innerHTML = fragments.join('');
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.root.remove();
  }
}

/** Eight-way arrow for a bearing (0 = ahead, positive = right). */
export function compassArrow(bearing: number): string {
  const arrows = ['\u2191', '\u2197', '\u2192', '\u2198', '\u2193', '\u2199', '\u2190', '\u2196'];
  const index = Math.round(bearing / (Math.PI / 4));
  return arrows[((index % 8) + 8) % 8]!;
}

/** 950 -> "950 u", 12,400 -> "12.4 ku". */
export function formatDistance(units: number): string {
  if (units < 1000) return `${units.toFixed(0)} u`;
  return `${(units / 1000).toFixed(units < 10_000 ? 2 : 1)} ku`;
}

function escapeText(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
}
