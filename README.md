# Known Universe Explorer

> *Fly the Known Universe. Land on its worlds. Ask your Mentat.*

A browser game set in Frank Herbert's Dune universe, written from scratch in TypeScript and three.js for **Computer Graphics & Virtual Reality (CS373IA), RVCE, Semester VII**.

Pilot a ship around the star Canopus and its six worlds, from Arrakis to Ix. Thread an asteroid belt, skirt the edge of a black hole that bends starlight into a ring, and land anywhere you point your nose. The ground under your feet is built from the same terrain you saw from orbit. Your onboard **Mentat** answers questions about each world and can teleport you to it.

And when the examiner asks *"where is the depth buffer?"*, press **X**.

---

## What's in it

Every feature is there to make one syllabus topic visible, and the X-Ray panel can expose most of them live.

| Feature | How it works | Unit |
|---|---|---|
| **Fixed-timestep engine** | 1/120 s physics with render interpolation, so behaviour is identical at 30 or 144 fps | V |
| **On-rails orbits** | Kepler's equation solved by Newton's method each step; orbit ellipses drawn as line loops | V, III |
| **Scene-graph planets** | star → orbit pivot → axial tilt → spin → mesh, so a planet's day never leaks into its year | V, IV |
| **Procedural planets** | Cube-sphere displaced by FBM simplex noise in the vertex shader, 3 LOD levels, per-biome palettes, day/night terminator, city lights | I, V |
| **Atmospheres** | Back-face shell whose glow depends on how far each view ray passes above the surface | V |
| **CPU = GPU terrain** | The GLSL noise is ported line by line to TypeScript, so collision height equals rendered height (unit-tested against GPU read-back) | V |
| **Asteroid belt** | 2,000 noise-deformed rocks in **one** instanced draw call, with distance LOD | I |
| **Collision** | Loose octree broad phase, sphere and heightfield narrow phase, impulse response with restitution, hull damage, camera shake | V |
| **Newtonian flight** | 6-DOF quaternion ship, velocity-Verlet gravity from the star and the planet whose sphere of influence you're in, and a predicted 30 s trajectory | IV, V |
| **Black hole** | "The Silent Maw" (not canon): depth-aware gravitational-lensing post pass, accretion disk with Kepler shear and Doppler beaming, bloom | I, V |
| **Landing** | Ray-sphere landing target, a 1.5 s warp, then a surface generated from the planet's seed **and** the exact landing point | V |
| **On foot** | Walker under each planet's own g = GM/R², heightfield collision with a slope limit, swimming, biome sky, fog and dust, landmarks | V |
| **HUD and radar** | HTML overlay driven only by events; the radar is a window-to-viewport transform with clipping | III |
| **The Mentat** | Streaming LLM advisor grounded in `planets.json`, with tool calls to list destinations, read lore and **teleport** you | — |
| **System map** | Orthographic top-down view, to compare with the perspective flight view | IV |
| **X-Ray mode** | Wireframe, normals, back faces, bounding spheres, octree cells, camera frustum (picture-in-picture), depth buffer, live 4×4 matrix | I, III, IV, V |
| **Input** | Physical keys mapped to logical actions, in both request and event modes, with a rebindable controls menu | II |
| **Sound** | Engine, impacts, warp and wind, all synthesised with Web Audio; music at 40% of the ship's level | II |

---

## Getting started

Requires **Node 22+** and a WebGL2 browser (Chrome recommended).

```bash
npm install
npm run dev        # the game, on http://localhost:5173
npm run server     # the Mentat proxy, on :8787 (second terminal)
```

### The Mentat (optional, but fun)

The Mentat talks to an OpenAI-compatible model through a small local proxy, so the key never reaches the browser. Create `server/.env`:

```
GROQ_API_KEY=your-key-here
# optional: LLM_MODEL=openai/gpt-oss-120b, LLM_BASE_URL=...
```

With no key, or no network, the Mentat answers from `planets.json` by itself, teleports included. The demo never depends on Wi-Fi.

### Optional assets

| Drop in | Where | Without it |
|---|---|---|
| Background music (CC0/CC-BY) | `public/audio/music.mp3` | A desert score generated in code |
| Skybox cubemap (6 faces) | `public/skybox/px.png … nz.png` | A procedural star field |
| Ship model (glTF) | `public/models/ship.glb` | A built-in low-poly hull |

See the `README.md` inside each `public/` folder.

### Other commands

```bash
npm test           # Vitest: 100+ tests for kepler, integrator, noise, collision, octree, gravity, terrain, walker, Mentat
npm run typecheck  # tsc --noEmit (strict)
npm run build      # production build into dist/
```

---

## Controls

| Key | In space | On foot |
|---|---|---|
| **W / S** | Thrust / reverse | Walk / back |
| **A / D**, **← / →** | Yaw | Turn |
| **↑ / ↓** | Pitch | Look up / down |
| **Q / E** | Roll | — |
| **Shift** | Boost | Run |
| **Space** | Brake | Jump |
| **Click** | Mouse flight (Esc releases) | Mouse look |
| **L** | Land on the planet under the reticle | Return to orbit |
| **M** | Mentat | Mentat |
| **X** | X-Ray panel | X-Ray panel |
| **O** | Orthographic system map | — |
| **Enter** | Launch (title screen) | — |

Every key can be rebound from **Controls** on the title screen.

**Try asking the Mentat:** *"Where can I go?"*, *"What can I see here?"*, *"Tell me about Giedi Prime"*, *"Take me to the Thumper on Arrakis."*

---

## How it's built

```
Input ──► InputManager (logical actions) ──► EventBus ◄── HUD · Lore cards · Mentat · Audio
                                               │
Engine (fixed 1/120 s update, interpolated render)
  └─ StateMachine: Boot → Menu → Space ⇄ Warp ⇄ Surface
        Space:   SolarSystem (Kepler) · Ship (Verlet) · AsteroidField + Octree · BlackHole
        Surface: TerrainManager (3×3 chunks) · Walker · PointsOfInterest
        each:    PostFX (bloom, lensing / aberration, tone mapping) · XRay
                                               │
Mentat panel ── fetch /api/mentat (SSE) ──► Hono proxy ── tool-calling loop ──► LLM
```

- **TypeScript (strict)**, **Vite**, vanilla **three.js** (no framework, so the matrices stay explicit), **pmndrs/postprocessing**, **Hono**.
- All world data, both generation and lore, lives in one file: `src/data/planets.json`.
- Systems talk only through a typed `EventBus`, and scenes ask for transitions rather than performing them.
- GLSL lives in real `.glsl` files under `src/shaders/`.

`SYSTEM_DESIGN.md` has the full design, and `BUILD_PLAN.md` the day-by-day plan.

---

## Credits

- **three.js** (MIT), **postprocessing** (Zlib), **lil-gui** (MIT), **Hono** (MIT).
- **Simplex noise** adapted from Ashima Arts / Stefan Gustavson's *webgl-noise* (MIT), in GLSL and ported to TypeScript.
- Black-hole lensing written from textbook point-lens formulas; *guruprasadregar1-afk/blackhole-physics* (MIT) was read as a reference.
- All sound effects and the fallback music are synthesised in code.
- Full list, with any music or models you add: `ASSETS_AND_CREDITS.md`.

**About the Dune content:** names and setting come from Frank Herbert's *Dune* and are used for coursework only. All lore text is written in our own words, with nothing copied from the books, wikis or films, and no film art or music. *The Silent Maw* is an original addition and not part of Dune canon.
