# Build Plan (about 2 weeks)

Start after the PAGP submission. Each day ends with something you can run and screenshot. Commit daily.

## Milestones

| Day | Goal | Done when |
|---|---|---|
| 1 | Scaffold + flight | Vite + TS + three.js runs; state machine stub; InputManager; skybox; ship model flies with chase camera |
| 2 | Solar system | `planets.json` loaded; star + 6 planets on Kepler orbits; orbit lines; planet spin + axial tilt; day/night shader |
| 3 | Procedural planets | Cube-sphere + FBM displacement; per-biome palettes; atmosphere shader; 3 LOD levels |
| 4 | Asteroids + collision | Instanced asteroid belt; octree broad phase; sphere collision with bounce, damage and camera shake; engine trail particles |
| 5 | Gravity + HUD | Ship gravity (Verlet); predicted trajectory line; HUD (speed, hull, nearest body, distance); lore card on approach |
| 6 | Black hole | Lensing post-process pass; accretion disk shader; bloom; lore card for the anomaly |
| 7 | Landing | Ray-sphere landing target; Warp transition; surface scene generated from the planet seed; terrain chunks |
| 8 | Surface exploration | Walker/rover controller; heightfield collision; biome sky, fog and dust; 2–3 points of interest per planet |
| 9 | Mentat | Hono proxy with streaming; context builder; chat panel; static fallback |
| 10 | X-Ray + polish | X-Ray panel complete; orthographic map toggle; audio; perf pass; title screen |
| 11–12 | Buffer + report | Fix bugs; record a backup demo video; write the report and viva notes |

## Cut list (only if behind schedule, in this order)

1. Surface points of interest → keep plain terrain only
2. Orthographic system map
3. Audio
4. Mentat streaming → plain request/response

## Stretch (only after Day 10 is done)

- Sandworm on Arrakis (behaviour modelling)
- Mentat `setCourse` tool call → waypoint
- WebXR cockpit mode
- In-browser embedding retrieval for the Mentat

## Demo script (3 minutes)

1. Title screen over Arrakis → launch.
2. Fly through the asteroid belt; clip one to show collision.
3. Swing past the black hole; show lensing.
4. Ask the Mentat about Caladan; set course.
5. Land on Arrakis; walk the dunes.
6. Press X: wireframe, octree, depth buffer, live matrix. Explain one syllabus topic per toggle.
