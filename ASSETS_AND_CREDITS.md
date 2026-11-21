# Assets, Libraries and Credits

Check each LICENSE file yourself before copying code. "Reference" means read and learn from it, then write your own version.

## Code and libraries

| What | Source | License | Use |
|---|---|---|---|
| three.js | github.com/mrdoob/three.js | MIT | Engine |
| postprocessing | github.com/pmndrs/postprocessing | Zlib | Bloom, custom lensing pass |
| webgl-noise (Ashima / stegu) | github.com/stegu/webgl-noise | MIT | GLSL simplex noise (`shaders/simplex3d.glsl`), plus our TypeScript port of it for CPU collision (`physics/noise.ts`) |
| lil-gui | npm `lil-gui` | MIT | Debug panel |
| Hono | npm `hono` | MIT | Mentat proxy |
| howler (optional) | npm `howler` | MIT | Audio |
| Procedural planets | github.com/dgreenheck/threejs-procedural-planets | Check LICENSE | Adapt if MIT; otherwise reference only |
| Lagrange planet builder | github.com/EepyBerry/lagrange | BSD-3-Clause | Reference for biome system |
| Black hole lensing | github.com/guruprasadregar1-afk/blackhole-physics | MIT | Reference only: `render/LensingEffect.ts` and `lensing.frag.glsl` were written from the textbook point-lens formulas, no code copied |
| Black hole (alt) | github.com/flightlesstux/javascript-blackhole | Check LICENSE | Reference for the post-process structure |

## Art and audio

| What | Source | License |
|---|---|---|
| Spaceship models (glTF) | Quaternius LowPoly Spaceships / Ultimate Space Kit (quaternius.com) | CC0 |
| Skybox cubemap | Generated with wwwtyro space-3d (wwwtyro.github.io/space-3d) | Unlicense (generator) |
| Sound effects | Synthesised in code (`src/core/AudioManager.ts`), no files | Ours |
| Background music (fallback) | Generated in code (`src/core/MusicPlayer.ts`): drone + D Phrygian-dominant melody | Ours |
| Background music (optional file) | `public/audio/music.mp3`: FILL IN title, artist, URL | Must be CC0 or CC-BY (credit the artist if CC-BY) |

## Dune content

- Planet names and lore come from Frank Herbert's Dune. Use them for this coursework only.
- Write all lore and trivia in your own words. Do not copy text from the books, wikis or films.
- Do not use film stills, posters, logos or official artwork. Any sandworm, ships or emblems are our own designs.
