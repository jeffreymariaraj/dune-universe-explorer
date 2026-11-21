// Day 3 (orbit look) and Day 8 (surface look). Unit V: visual appearance.
//
// Per-biome rules, keyed by generation.biome in planets.json ('desert', 'ocean',
// 'industrial', 'temperate', 'wasteland', 'ice'). planets.json supplies each
// planet's palette, noise and atmosphere colour; this table supplies what those
// cannot: whether the world has seas, polar caps and shiny water (orbit, Day 3),
// and how thick the air is and what blows through it (surface, Day 8). One data
// table drives the look of a world from orbit and on foot.
//
// The sea level is also a COLLISION rule: noise.ts flattens terrain below it, so
// it is passed to both the shader and physics/noise.ts from here.

export interface Biome {
  /** Normalised height [-1, 1] below which the surface is flat water; null = dry world. */
  seaLevel: number | null;
  /** Deep and shallow water colours; null = use palette[0] and palette[1]. */
  water: { deep: string; shallow: string } | null;
  /**
   * Where land starts on the 3-colour palette ramp (0..1). Ocean worlds spend
   * palette[0] on deep water, so their land starts half way along.
   */
  landRampStart: number;
  /** |sin(latitude)| above which ice caps appear; 2 = no caps. */
  polarCap: number;
  /** Strength of the sun's glint on water (and ice), 0..1. */
  specular: number;

  // ---- surface (Day 8). Sky colour itself comes from planets.json atmosphere.
  /** Linear fog start and end, world units: thick air ends sooner. Must end before ~300 to hide the chunk edge. */
  fog: { near: number; far: number };
  /** Particles carried on the wind around the walker. */
  dust: {
    color: string;
    count: number;
    /** World-unit size of each mote. */
    size: number;
    /** Drift, world units per second (y < 0 falls, e.g. snow). */
    wind: [number, number, number];
    opacity: number;
  };
  // TODO(Day 10, optional): ambient audio per biome.
}

export const BIOMES: Readonly<Record<string, Biome>> = {
  desert: {
    seaLevel: null,
    water: null,
    landRampStart: 0,
    polarCap: 2,
    specular: 0,
    fog: { near: 40, far: 240 },
    dust: { color: '#d9a066', count: 2600, size: 0.35, wind: [7, 0.4, 2], opacity: 0.55 },
  },
  ocean: {
    seaLevel: 0.05,
    water: null,
    landRampStart: 0.5,
    polarCap: 0.82,
    specular: 0.9,
    fog: { near: 140, far: 300 },
    dust: { color: '#eef6ff', count: 700, size: 0.18, wind: [3, 0.6, 0], opacity: 0.35 },
  },
  industrial: {
    seaLevel: null,
    water: null,
    landRampStart: 0,
    polarCap: 2,
    specular: 0.15,
    fog: { near: 25, far: 200 },
    dust: { color: '#2b2b2b', count: 2200, size: 0.3, wind: [1.5, -0.3, 0.5], opacity: 0.7 },
  },
  temperate: {
    seaLevel: -0.12,
    water: { deep: '#14304d', shallow: '#2a6f97' },
    landRampStart: 0,
    polarCap: 0.88,
    specular: 0.6,
    fog: { near: 140, far: 300 },
    dust: { color: '#f4e285', count: 500, size: 0.14, wind: [1, 0.3, 0.4], opacity: 0.5 },
  },
  wasteland: {
    seaLevel: null,
    water: null,
    landRampStart: 0,
    polarCap: 2,
    specular: 0,
    fog: { near: 50, far: 250 },
    dust: { color: '#8d7966', count: 1800, size: 0.3, wind: [4, -0.2, 2], opacity: 0.55 },
  },
  ice: {
    seaLevel: null,
    water: null,
    landRampStart: 0,
    polarCap: 0.55,
    specular: 0.35,
    fog: { near: 70, far: 270 },
    dust: { color: '#ffffff', count: 2400, size: 0.22, wind: [2, -2.5, 0.5], opacity: 0.8 },
  },
};

/** Fallback for a biome name planets.json uses but this table does not know. */
export const DEFAULT_BIOME: Biome = BIOMES['desert']!;

export function biomeFor(name: string): Biome {
  const biome = BIOMES[name];
  if (!biome) console.warn(`Biomes: unknown biome "${name}", using desert`);
  return biome ?? DEFAULT_BIOME;
}
