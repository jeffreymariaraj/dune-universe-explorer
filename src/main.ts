// Entry point. Wires the pieces together and owns nothing itself:
//
//   Engine        drives a fixed 1/120 s simulation step and a variable render
//   StateMachine  Boot -> Space <-> Warp <-> Surface (Menu arrives on Day 10)
//   SpaceScene    owns the SolarSystem built from planets.json (Day 2)
//   transitions   states ask on the bus ('state:request'); this file performs
//                 the change between frames, never in the middle of an update
//   InputManager  the only place in the project that listens to a device
//   EventBus      how the debug panel (and later the HUD) hears about the ship
//
// See SYSTEM_DESIGN.md section 3 for the diagram this file implements.

import { AssetLoader } from './core/AssetLoader';
import { Engine, type Simulation } from './core/Engine';
import { EventBus } from './core/EventBus';
import { InputManager } from './core/InputManager';
import { StateMachine } from './core/StateMachine';
import { BootState } from './core/states/BootState';
import { MenuState } from './core/states/MenuState';
import { WarpState } from './core/states/WarpState';
import type { GameStateName } from './core/StateMachine';
import { BELT_ID, SpaceScene } from './space/SpaceScene';
import { SurfaceScene } from './surface/SurfaceScene';
import { DebugOverlay } from './ui/DebugOverlay';
import { HUD } from './ui/HUD';
import { LoreCard } from './ui/LoreCard';
import { ScreenFade } from './ui/ScreenFade';
import { MentatPanel } from './ui/MentatPanel';
import { TitleScreen } from './ui/TitleScreen';
import { AudioManager } from './core/AudioManager';

async function main(): Promise<void> {
  const canvas = document.getElementById('viewport');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('main: #viewport canvas is missing from index.html');
  }

  const bus = new EventBus();
  const engine = new Engine(canvas, bus);
  const assets = new AssetLoader(bus);
  const input = new InputManager(canvas, bus);
  const machine = new StateMachine(bus);

  const boot = new BootState(bus);
  const space = new SpaceScene(assets, input, bus, engine.renderer);
  machine.register(boot);
  machine.register(new MenuState(bus, engine.renderer, assets));
  machine.register(space);
  const surface = new SurfaceScene(input, bus, engine.renderer);
  machine.register(new WarpState(bus, engine.renderer));
  machine.register(surface);

  // Unit II: event-driven control flow. A state asks; the change is queued and
  // carried out after the frame, so no state is torn down mid-update.
  let pendingChange: { to: GameStateName; payload?: unknown } | null = null;
  bus.on('state:request', (request) => {
    pendingChange = request;
  });
  const applyPendingChange = (): void => {
    if (!pendingChange) return;
    const { to, payload } = pendingChange;
    pendingChange = null;
    machine.change(to, payload).catch((error: unknown) => console.error(error));
  };

  /**
   * The engine drives the state machine, with one extra responsibility: mouse
   * deltas are per-frame quantities, so they are cleared after the frame's
   * render — not inside a fixed step, which may run several times per frame.
   */
  const simulation: Simulation = {
    update: (dt) => machine.update(dt),
    render: (alpha, renderer) => {
      machine.render(alpha, renderer);
      input.endFrame();
      applyPendingChange();
    },
    resize: (width, height) => machine.resize(width, height),
  };

  engine.setSimulation(simulation);
  engine.start();

  // Day 5/7: the HUD, lore card and fade layer only listen to the bus. They
  // exist before the first state so they hear every 'state:changed'.
  const overlay = document.getElementById('overlay') ?? document.body;
  const hud = new HUD(overlay, bus);
  const loreCard = new LoreCard(overlay, bus);
  const fade = new ScreenFade(overlay, bus);
  // Day 9: the Mentat chat (M). Talks to the proxy; teleports go out on the bus.
  const mentat = new MentatPanel(overlay, bus, input);
  // Day 10: title screen and controls menu (HTML half of the Menu state).
  const title = new TitleScreen(overlay, bus, input);
  // Day 10: synthesised sound, driven by bus events only.
  const audio = new AudioManager(bus);

  // The debug panel points at the space scene's objects, which are rebuilt on
  // every visit to Space, so the panel is rebuilt with them.
  let debug: DebugOverlay | null = null;
  const devHandle: Record<string, unknown> = {};
  bus.on('state:changed', ({ to }) => {
    debug?.dispose();
    debug = null;
    if (to === 'Space') {
      debug = new DebugOverlay(engine, bus, space.controller, space.rig, input, {
        skyMode: space.skybox.skyMode === 'cubemap' ? 'cubemap (public/skybox)' : 'procedural fallback',
        shipModel: space.ship.usingFallbackModel ? 'fallback cone' : 'ship.glb',
      }, {
        system: space.solarSystem,
        jumpTo: (id) => space.jumpTo(id),
        asteroids: space.asteroids,
        impact: space.impact,
        beltId: BELT_ID,
        postFX: space.postFX,
        audio,
      });
    }
    devHandle['debug'] = debug;
  });

  // main.ts drives the boot sequence; a state never transitions itself from enter().
  // Boot -> Menu (title screen); the menu asks for Space when you launch.
  await machine.change('Boot');
  await boot.preload();
  await machine.change('Menu');

  // Unit II: event-mode input. Trigger actions arrive as events on the bus and
  // each owner listens for its own: X -> render/XRay.ts (per scene),
  // M -> ui/MentatPanel.ts, L -> SpaceScene / SurfaceScene, O -> SpaceScene's
  // system map, Enter -> MenuState.

  // Dev-only handle, so the ship can be inspected and poked from the browser
  // console (and so Day 10's viva demo can pause or teleport without a rebuild).
  // Stripped from production builds by the import.meta.env.DEV check.
  if (import.meta.env.DEV) {
    Object.assign(devHandle, { engine, machine, space, surface, input, bus, hud, loreCard, mentat, audio });
    (window as unknown as Record<string, unknown>)['kue'] = devHandle;
  }

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      debug?.dispose();
      hud.dispose();
      fade.dispose();
      mentat.dispose();
      title.dispose();
      audio.dispose();
      loreCard.dispose();
      input.dispose();
      void machine.disposeAll();
      assets.dispose();
      engine.dispose();
    });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  const status = document.getElementById('boot-status');
  if (status) {
    status.textContent = error instanceof Error ? error.message : 'Failed to start.';
  }
});
