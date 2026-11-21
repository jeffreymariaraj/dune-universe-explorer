// Day 7 (collision on Day 8). Unit V: object shape and surface deformation.
//
// The surface heightfield: ground height y at local (x, z), as a pure function,
// so the terrain mesh (TerrainChunk) and the walker's ground clamp (Day 8) call
// the SAME code and can never disagree.
//
// It is tied to the planet you saw from orbit. The landing point is a unit
// direction `site` in the planet's own frame. Local surface coordinates are
// wrapped back onto the sphere around that point,
//
//   dir(x, z) = normalize(site + east * x / S - north * z / S)
//
// (S = world units per radian of the planet: a "zoom"), and the planet's own
// FBM terrain function from physics/noise.ts is sampled there. So land where
// the orbital map shows sea and you arrive at a shore or open water; land on a
// ridge and you stand on high ground. On top of that, a few octaves of finer
// local noise give walkable detail (ridged on desert worlds, for dunes).
//
// Local frame: +y up, -z is north, +x is east (three.js convention).

import { createRandom, fbm, type HeightParams } from './noise';

export interface TerrainParams {
  /** The planet's terrain function (noise, seed offset, sea level). */
  planet: HeightParams;
  /** Landing direction in the planet's frame (unit vector). */
  site: readonly [number, number, number];
  /** World units per radian of planet: how far the surface is "zoomed". */
  unitsPerRadian: number;
  /** Height in world units of the planet's full normalised range (-1..1 -> +-relief). */
  relief: number;
  /** Fine local detail. */
  detail: { amplitude: number; frequency: number; octaves: number; ridged: boolean; offset: readonly [number, number] };
}

/** The tangent frame (east, north) at the site, used to wrap x/z onto the sphere. */
export interface SiteFrame {
  east: [number, number, number];
  north: [number, number, number];
}

export function siteFrame(site: readonly [number, number, number]): SiteFrame {
  const [sx, sy, sz] = site;
  // east = normalize(up x site), with a fallback at the poles.
  let ex = sz;
  let ey = 0;
  let ez = -sx;
  let length = Math.hypot(ex, ey, ez);
  if (length < 1e-6) {
    ex = 1;
    ey = 0;
    ez = 0;
    length = 1;
  }
  ex /= length;
  ey /= length;
  ez /= length;
  // north = site x east (completes a right-handed frame with up = site)
  const nx = sy * ez - sz * ey;
  const ny = sz * ex - sx * ez;
  const nz = sx * ey - sy * ex;
  return { east: [ex, ey, ez], north: [nx, ny, nz] };
}

/** Build the parameters for a landing. Deterministic: same planet + site, same ground. */
export function terrainParamsFor(
  planet: HeightParams,
  site: readonly [number, number, number],
  seed: number,
  ridgedDetail: boolean,
): TerrainParams {
  const random = createRandom(seed ^ 0x5eed);
  return {
    planet,
    site,
    unitsPerRadian: 20_000,
    // Taller worlds from orbit get taller hills on foot.
    relief: 1500 * planet.amplitude,
    detail: {
      amplitude: ridgedDetail ? 7 : 4,
      frequency: 1 / 90,
      octaves: 4,
      ridged: ridgedDetail,
      offset: [random() * 1000, random() * 1000],
    },
  };
}

/** The planet-scale height (normalised, unclamped) at local (x, z). */
export function macroHeight(x: number, z: number, params: TerrainParams, frame: SiteFrame): number {
  const [sx, sy, sz] = params.site;
  const u = x / params.unitsPerRadian;
  const v = -z / params.unitsPerRadian;
  let dx = sx + frame.east[0] * u + frame.north[0] * v;
  let dy = sy + frame.east[1] * u + frame.north[1] * v;
  let dz = sz + frame.east[2] * u + frame.north[2] * v;
  const length = Math.hypot(dx, dy, dz);
  dx /= length;
  dy /= length;
  dz /= length;
  const p = params.planet;
  const [ox, oy, oz] = p.offset;
  return fbm(dx * p.frequency + ox, dy * p.frequency + oy, dz * p.frequency + oz, p.octaves, p.ridged);
}

/** Ground height y (world units) at local (x, z). The one function mesh and collision share. */
export function terrainHeight(x: number, z: number, params: TerrainParams, frame: SiteFrame): number {
  const macro = macroHeight(x, z, params, frame) * params.relief;
  const d = params.detail;
  const detail = fbm(
    x * d.frequency + d.offset[0],
    0.5,
    z * d.frequency + d.offset[1],
    d.octaves,
    d.ridged,
  );
  return macro + detail * d.amplitude;
}

/** World-space height of the water plane, or null on a dry world. */
export function waterLevel(params: TerrainParams): number | null {
  return params.planet.seaLevel === null ? null : params.planet.seaLevel * params.relief;
}
