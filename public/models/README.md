# Ship model

Put a single glTF binary here, named exactly `ship.glb`.

## Where to get one

[Quaternius](https://quaternius.com) — *LowPoly Spaceships* or the *Ultimate Space
Kit*, both CC0 (public domain, no attribution required, though we credit them in
`ASSETS_AND_CREDITS.md` anyway). Download the glTF version and copy one `.glb`
here as `ship.glb`.

## What the loader does to it

`src/ship/Ship.ts` centres the model on its bounding box, scales its longest axis
to 6 world units, and takes its collision radius from those bounds — so the model
can be any size or orientation on disk, as long as **it faces -Z** (three.js
forward). If your model points the wrong way, rotate it in Blender and re-export,
or add a rotation in `normaliseModel()`.

**If this file is missing the game still runs**: you fly a cone with two
navigation lights. The lil-gui panel's *Assets → ship* row says which.
