# Skybox cubemap faces

Drop six PNGs in this folder, named exactly:

```
px.png  nx.png   (+X, -X)
py.png  ny.png   (+Y, -Y)
pz.png  nz.png   (+Z, -Z)
```

That is three.js `CubeTextureLoader` order, which is what `src/space/Skybox.ts`
asks for.

## How to generate them

1. Open <https://wwwtyro.github.io/space-3d/> (wwwtyro/space-3d, Unlicense).
2. Set the resolution to 2048, pick a seed you like, enable stars and a nebula or two.
3. Click **Download cube map** — you get a zip of six faces.
4. Rename them to the names above and put them here.

Keep the seed you used in `ASSETS_AND_CREDITS.md` so the sky is reproducible.

**If this folder is empty the game still runs**: `Skybox.ts` probes for the files
and falls back to a procedural `THREE.Points` star shell. The lil-gui panel's
*Assets → sky* row tells you which one you are looking at.
