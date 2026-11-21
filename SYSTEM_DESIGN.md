# Known Universe Explorer: System Design

A browser-based, interactive exploration of the Dune universe. The user pilots a ship through a procedurally generated star system, flies past a black hole, lands on planets, and asks an onboard LLM advisor (the "Mentat") about what they are looking at.

Course: Computer Graphics & Virtual Reality (CS373IA), Semester VII, RVCE.

---

## 1. Goals and non-goals

**Goals**
- Visually striking, smooth (60 fps on an M3 MacBook in Chrome), demo-ready in a viva.
- Every syllabus unit has a visible, explainable feature (see §10).
- Reuse open-source code and CC0 assets wherever possible. We write the glue, the game logic, and the parts the viva will probe.
- An "X-Ray" debug mode that reveals the graphics pipeline underneath (wireframes, bounding volumes, octree cells, depth buffer, orbit lines).

**Non-goals**
- Real astrophysical scale or units. Everything is scaled for fun and float precision.
- Seamless orbit-to-ground flight. Landing is a warp transition into a separate surface scene.
- Multiplayer, saving progress, mobile touch controls (stretch only).

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Type safety for vectors and state; Claude Code works well with it |
| Build / dev server | Vite | Instant hot reload, native GLSL imports via `vite-plugin-glsl` |
| 3D engine | three.js (WebGLRenderer, WebGL2) | Industry standard; vanilla (not React Three Fiber) so the render loop, scene graph and matrices stay explicit, which maps directly to OpenGL concepts in the syllabus |
| Post-processing | `postprocessing` (pmndrs) | Bloom, vignette, and a custom lensing effect pass |
| Noise | Ashima `webgl-noise` GLSL (GPU) + our TypeScript port of the same function in `physics/noise.ts` (CPU) | The same seeded noise function on CPU and GPU, so collision heights match what is rendered. A separate CPU library (npm `simplex-noise`) cannot match the GLSL value for value, so the CPU side is a line-by-line port, checked against GPU read-back in `noise.test.ts` |
| Physics | Custom (Kepler orbits, velocity Verlet, sphere / heightfield collision) | Small, explainable, no engine needed. See §6 |
| Debug UI | `lil-gui`, three.js `Stats` | Live parameter tweaking and fps counter |
| HUD / menus | Plain HTML + CSS overlay | Faster than in-canvas UI, easy to make beautiful |
| Audio (optional) | `howler` | Engine hum, warp, ambience |
| LLM (Mentat) | Any OpenAI-compatible API (Groq, Gemini, OpenRouter) through a tiny local proxy | Free tiers exist; the key never reaches the browser |
| Proxy server | Node + Hono (`server/`) | ~50 lines; holds the API key in `.env` |
| VR (stretch) | three.js `VRButton` / WebXR | Cockpit view in a headset or phone viewer |
| Hosting | GitHub Pages or Vercel (frontend); proxy runs locally for the demo | Free |

**Dev environment:** macOS (M3), Node 22 LTS, npm, VS Code or Cursor with Claude Code, Chrome (with the Spector.js extension for inspecting WebGL draw calls), Git + GitHub.

---

## 3. High-level architecture

```
┌──────────────────────────── Browser ────────────────────────────┐
│                                                                  │
│  Input (keyboard/mouse/gamepad) ──► InputManager (logical acts)  │
│                                          │                       │
│                                          ▼                       │
│  ┌──────────── Engine (fixed-step update, variable render) ────┐ │
│  │  StateMachine: Boot → Menu → Space ⇄ Warp ⇄ Surface         │ │
│  │                                                             │ │
│  │  Space scene                     Surface scene              │ │
│  │   • SolarSystem (scene graph)     • TerrainChunks (seeded)  │ │
│  │   • OrbitSystem (Kepler)          • Walker/Rover controller │ │
│  │   • Ship + ShipPhysics (Verlet)   • Heightfield collision   │ │
│  │   • AsteroidField + Octree        • Biome sky / fog / dust  │ │
│  │   • BlackHole + accretion disk    • Points of interest      │ │
│  │   • Skybox / Starfield / Nebula                             │ │
│  │                                                             │ │
│  │  Renderer: three.js → postprocessing (Lensing, Bloom)       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│        │ events (EventBus)                                       │
│        ▼                                                         │
│  HUD / Lore cards / X-Ray panel / Mentat chat  (HTML overlay)    │
│        │ fetch /api/mentat                                       │
└────────┼─────────────────────────────────────────────────────────┘
         ▼
  Local proxy (Hono, .env key) ──► OpenAI-compatible LLM API
```

---

## 4. Folder structure

```
known-universe/
├─ index.html
├─ vite.config.ts
├─ package.json
├─ CLAUDE.md
├─ public/
│  ├─ models/          # Quaternius ship .glb
│  ├─ skybox/          # 6 cubemap faces from space-3d
│  ├─ textures/        # night-lights, sand normal maps, etc.
│  └─ audio/
├─ src/
│  ├─ main.ts
│  ├─ core/
│  │  ├─ Engine.ts            # renderer, clock, fixed-step loop
│  │  ├─ StateMachine.ts
│  │  ├─ EventBus.ts
│  │  ├─ InputManager.ts      # physical devices → logical actions
│  │  ├─ AssetLoader.ts
│  │  └─ AudioManager.ts      # synthesised Web Audio, driven by bus events
│  ├─ space/
│  │  ├─ SpaceScene.ts
│  │  ├─ SolarSystem.ts       # builds hierarchy from planets.json
│  │  ├─ Star.ts              # photosphere shader, corona sprite, point light
│  │  ├─ Planet.ts            # cube-sphere + FBM displacement, THREE.LOD
│  │  ├─ CubeSphere.ts        # shared unit cube-sphere geometry per LOD level
│  │  ├─ landing.ts           # planet-frame maths, day-side landing sites
│  │  ├─ Atmosphere.ts
│  │  ├─ AsteroidField.ts     # InstancedMesh
│  │  ├─ SystemMap.ts         # orthographic top-down map (O)
│  │  ├─ BlackHole.ts
│  │  └─ Skybox.ts
│  ├─ ship/
│  │  ├─ Ship.ts
│  │  ├─ ShipController.ts    # 6-DOF, quaternions
│  │  ├─ CameraRig.ts         # chase / cockpit / orbit cams
│  │  ├─ EngineTrail.ts       # particles
│  │  └─ TrajectoryLine.ts    # predicted-path polyline
│  ├─ surface/
│  │  ├─ SurfaceScene.ts
│  │  ├─ TerrainChunk.ts
│  │  ├─ TerrainManager.ts    # chunk streaming around player
│  │  ├─ Walker.ts
│  │  ├─ PointsOfInterest.ts  # 2-3 landmarks per planet from planets.json
│  │  └─ Biomes.ts
│  ├─ physics/
│  │  ├─ kepler.ts            # on-rails orbits
│  │  ├─ integrator.ts        # velocity Verlet
│  │  ├─ collision.ts         # sphere-sphere, ray-sphere, contact response
│  │  ├─ noise.ts             # CPU port of the GLSL terrain noise (heightfield)
│  │  ├─ gravity.ts           # inverse-square gravity, sphere of influence
│  │  ├─ trajectory.ts        # predicted trajectory (Verlet, engines off)
│  │  ├─ terrain.ts           # surface heightfield around a landing site
│  │  └─ Octree.ts
│  ├─ render/
│  │  ├─ PostFX.ts
│  │  ├─ LensingEffect.ts
│  │  └─ XRay.ts              # debug visualisations
│  ├─ shaders/                # .glsl files
│  ├─ mentat/
│  │  ├─ MentatClient.ts      # streams SSE from the proxy
│  │  ├─ contextBuilder.ts
│  │  └─ offlineMentat.ts     # answers and teleports from planets.json when offline
│  ├─ ui/
│  │  ├─ HUD.ts
│  │  ├─ LoreCard.ts
│  │  ├─ ScreenFade.ts        # black fade layer for the Warp transition
│  │  ├─ TitleScreen.ts       # title + remappable controls menu
│  │  ├─ MentatPanel.ts
│  │  └─ styles.css
│  └─ data/
│     ├─ planets.json
│     └─ systemData.ts         # typed, validated loader for planets.json
├─ api/
│  └─ index.ts                # Vercel Edge Function wrapping server/app.ts
├─ vercel.json
└─ server/
   ├─ app.ts                  # the Hono app: routes, caps, rate limit, SSE
   ├─ index.ts                # local server (:8787) for the app
   ├─ rateLimiter.ts          # per-IP + global sliding-window limits
   ├─ mentatAgent.ts          # streamed tool-calling loop
   ├─ mentatTools.ts          # list_destinations, list_points_of_interest, get_lore, teleport
   └─ .env.example
```

---

## 5. Core runtime

**Game loop.** `requestAnimationFrame` drives rendering. Physics runs on a fixed timestep (1/120 s) with an accumulator, so orbits and collisions behave the same regardless of frame rate. Rendering interpolates between the last two physics states.

**State machine.**
- `Boot`: load assets with a progress bar.
- `Menu`: title screen over a slowly rotating Arrakis.
- `Space`: free flight.
- `Warp`: 1.5 s transition (radial blur + fade, stars stretch) while the surface scene is generated from the planet's seed.
- `Surface`: on-foot or rover exploration; "Return to orbit" triggers `Warp` back.

**Input (Unit II).** Physical devices (keyboard, mouse, gamepad) are mapped to logical actions (`thrust`, `yaw`, `pitch`, `roll`, `boost`, `land`, `toggleXRay`, `openMentat`). Input modes: request (polled each frame), event (key-down triggers), and a pointer-lock mode for mouse flight. A remappable controls menu shows this off.

**Scale and precision.** The system fits inside a ±50,000-unit cube. If a far object ever jitters, apply floating-origin rebasing: when the ship passes 10,000 units from the origin, shift every object so the ship is back at the origin.

---

## 6. Simulation

**Planet orbits: on rails.** Each body follows a Keplerian ellipse computed from its elements (semi-major axis, eccentricity, inclination, period, phase). Solving Kepler's equation with a few Newton iterations per frame gives an exact, stable position. This is how real space games keep systems stable.

**Ship: Newtonian.** Gravity from the star and the dominant nearby planet (its sphere of influence) is integrated with velocity Verlet. A predicted trajectory line is drawn by integrating 600 steps ahead every few frames. This is the "physically simulated trajectory" that looks impressive on screen.

**Collision detection (Unit V).**
- Broad phase: an octree over the asteroids (built once; the belt is static). The six planets and the star are not in it: they move every step, and seven bounding-sphere checks are cheaper than rebuilding or querying a tree, so they get a direct bounding-sphere reject instead. A broad phase only pays for itself when the object count is large.
- Narrow phase: sphere vs sphere for ship vs asteroid and ship vs planet; ray vs sphere for the landing target.
- Surface: heightfield query. The ground height at (x, z) is computed from the same seeded noise as the terrain mesh.
- Response: reflect velocity, take hull damage, shake the camera, emit sparks.

**Planet rotation + day/night.** Each planet spins around its tilted axis (object hierarchy: orbit pivot → tilt → spin → mesh). A fragment shader blends a day colour and a night colour using dot(normal, sunDirection), with a soft terminator line and emissive city lights on the night side where appropriate (Kaitain, Giedi Prime).

---

## 7. Rendering features

| Feature | Approach | Reuse |
|---|---|---|
| Procedural planets | Cube-sphere (6 subdivided faces normalised to a sphere) displaced by FBM noise in the vertex shader; colour from height + biome ramp. 3 LOD levels via `THREE.LOD`. | Adapt from `dgreenheck/threejs-procedural-planets`; biome ideas from `EepyBerry/lagrange` |
| Atmosphere | Back-face sphere with a Fresnel / rim scattering shader | Same planet repo |
| Skybox + nebulae | Pre-rendered cubemap from the space-3d generator; plus a `Points` starfield layer for parallax | `wwwtyro/space-3d` (Unlicense) |
| Asteroid field | `InstancedMesh` of 2,000 noise-deformed icosahedrons in a torus belt; one draw call | Written by us |
| Black hole | Full-screen lensing pass (deflect UVs by 2Rs/b around the projected centre) + a shader-driven accretion disk + bloom | Reference `guruprasadregar1-afk/blackhole-physics` (MIT) |
| Ship | Low-poly glTF model | Quaternius LowPoly Spaceships (CC0) |
| Engine trails / dust | GPU particle `Points` with additive blending | Written by us |
| Surface terrain | 3×3 grid of chunks around the player, each a subdivided plane displaced on CPU by the planet's noise; chunks recycle as you move | Written by us |
| Post FX | Bloom, vignette, slight chromatic aberration during warp | `postprocessing` |

**Lore note.** The black hole is not part of Dune canon. Place it as an uncharted anomaly at the edge of the system and say so in its lore card.

---

## 8. Data model: `planets.json`

Each body drives both generation and lore:

```json
{
  "id": "arrakis",
  "name": "Arrakis",
  "type": "planet",
  "parent": "canopus",
  "orbit": { "a": 4200, "e": 0.03, "incDeg": 2, "periodSec": 600, "phase": 0.1 },
  "physical": { "radius": 220, "axialTiltDeg": 12, "dayLengthSec": 90, "mass": 1.0 },
  "generation": {
    "seed": 7041,
    "noise": { "octaves": 6, "frequency": 1.4, "amplitude": 0.06, "ridged": false },
    "biome": "desert",
    "palette": ["#8a5a2b", "#c9914f", "#e8c27a"],
    "atmosphere": { "color": "#e6a15c", "density": 0.6 }
  },
  "lore": {
    "title": "The Desert Planet",
    "summary": "Written in your own words.",
    "trivia": ["Fact 1, own words", "Fact 2, own words"]
  }
}
```

The same file is the Mentat's knowledge source, so the advisor and the lore cards never disagree.

---

## 9. The Mentat (LLM advisor)

**Flow.**
1. User opens the panel (`M`) and asks, e.g., "Why is this planet so dry?"
2. `contextBuilder` assembles: the current scene state (nearest body, distance, whether landed), the lore entry for that body, and the last 4 chat turns.
3. `MentatClient` POSTs to the local proxy at `/api/mentat`.
4. The proxy adds the system prompt and the API key, calls the LLM, and streams tokens back.
5. Answers render word by word in a styled terminal panel.

**System prompt (core).** "You are the ship's Mentat. Answer in 2–4 sentences, in-character but clear. Use only the lore provided in CONTEXT; if the answer is not there, say the archives are silent. Never invent canon."

**Grounding.** The lore file is small enough to pass the relevant entry directly (no vector database). Optional stretch: in-browser embeddings with transformers.js to retrieve across all entries, which you can call semantic retrieval.

**Scene actions (built on Day 9, at Jeff's request).** The proxy runs a tool-calling loop. The model can call `list_destinations`, `list_points_of_interest`, `get_lore` and `teleport`; the proxy checks every id against planets.json, and an accepted teleport is streamed to the browser as an action event. The active scene carries it out: a blink to a body's orbit, or a Warp straight down beside a landmark. This is the LLM agent hook. Offline, `offlineMentat.ts` answers the same kinds of request from planets.json, so teleports keep working without a network.

**Failure handling.** If the proxy is unreachable, the panel shows the static lore card instead, so the demo never breaks.

---

## 10. Syllabus mapping (viva cheat sheet)

| Unit | Topic | Where it shows up |
|---|---|---|
| I | Graphics pipeline, primitives, attributes, colour | three.js WebGL pipeline; custom shaders; X-Ray wireframe and normals |
| I | Display lists | Instanced asteroids and merged geometry (modern equivalent of compiling geometry once) |
| I | Three I's of VR, five components of a VR system | Immersion (cockpit, audio), interaction (flight, landing, Mentat), imagination (Dune world); report section mapping the five components |
| II | Logical input devices, measure and trigger, input modes, event-driven input, menus | InputManager action mapping; request vs event modes; remappable controls menu |
| II | VR input/output devices, sound, haptics | Gamepad rumble on collision; spatial audio; WebXR stretch |
| III | Lines, circles, fills | Orbit ellipses as line strips; HUD reticle and radar circles |
| III | 2D viewing, clipping | HUD minimap (window-to-viewport transform); orbit line clipping at the minimap border |
| III | 2D transforms, homogeneous coordinates | HUD element transforms; X-Ray shows the live 4×4 model matrix of the ship |
| IV | 3D transforms | Ship quaternion rotation; planet orbit → tilt → spin chain |
| IV | Viewing pipeline, view volume, 3D clipping | Chase / cockpit cameras; X-Ray frustum visualiser; near/far plane tuning |
| IV | Projections | Perspective flight view vs orthographic system map toggle |
| IV | Visible surface detection | Depth buffer view in X-Ray; back-face culling toggle; octree culling |
| V | Object shape, visual appearance | Procedural planets, materials, atmosphere shaders |
| V | Kinematics, object hierarchies, transformation invariants | Star → planet → moon scene graph; ship and child turrets/lights |
| V | Physical modelling: collision, surface deformation, force computation, smoothing | Octree + sphere collision; terrain from noise; gravity forces; damped camera follow |
| V | Behaviour modelling | Sandworm on Arrakis that hunts rhythmic movement (stretch); patrolling ships |

---

## 11. X-Ray mode

Toggle with `X`. A side panel with checkboxes:
- Wireframe
- Normals
- Bounding spheres
- Octree cells (coloured by occupancy)
- Camera frustum (seen from a second camera)
- Depth buffer view
- Orbit paths and predicted trajectory
- Live ship model matrix (4×4) and current state-machine state

This is the viva weapon: when asked "where is clipping / depth buffering / the hierarchy?", flip a switch and show it.

---

## 12. Performance budget

- Target: 60 fps at 1440p on M3, under 300 draw calls.
- Planets: about 40k triangles at the highest LOD; 3 LOD levels.
- Asteroids: 1 instanced draw call.
- Surface: 9 chunks × 128×128 vertices.
- Post FX: bloom at half resolution.
- Check with three.js `Stats` and Spector.js.

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Shader debugging eats days | Start from working repos; change one parameter at a time; keep a "safe" fallback material |
| Lensing looks wrong | Ship the simple UV-deflection version first; physical ray-marching only if time allows |
| LLM latency or free-tier limit during viva | Stream responses; cache answers to likely questions; static lore fallback |
| Scope creep | Hard cut list in BUILD_PLAN.md; stretch items only after the core demo is complete |
| Licensing questions | ASSETS_AND_CREDITS.md lists every reused piece; lore text written in our own words |
