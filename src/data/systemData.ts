// Day 2. Typed access to src/data/planets.json, the single source of truth for
// generation and lore (CLAUDE.md). The JSON is imported at build time and then
// validated once at startup, so a typo in the file fails loudly with the body's
// id instead of as a NaN orbit three scenes later.

import type { OrbitElements } from '../physics/kepler';
import rawSystem from './planets.json';

export interface LoreData {
  title: string;
  summary: string;
  trivia: string[];
}

export interface NoiseData {
  octaves: number;
  frequency: number;
  amplitude: number;
  ridged: boolean;
}

export interface GenerationData {
  seed: number;
  noise: NoiseData;
  biome: string;
  /** Three colours, low ground to high ground. */
  palette: [string, string, string];
  atmosphere: { color: string; density: number };
  nightLights: boolean;
}

export interface StarData {
  id: string;
  name: string;
  type: 'star';
  parent: null;
  physical: { radius: number; color: string; mass: number };
  lore: LoreData;
}

/** Day 8: a landmark placed near wherever you land on the planet. */
export type PointOfInterestKind = 'wreck' | 'monolith' | 'beacon' | 'ruin' | 'spire';

export interface PointOfInterestData {
  id: string;
  name: string;
  kind: PointOfInterestKind;
  description: string;
}

const POI_KINDS: readonly PointOfInterestKind[] = ['wreck', 'monolith', 'beacon', 'ruin', 'spire'];

export interface PlanetData {
  id: string;
  name: string;
  type: 'planet';
  parent: string;
  orbit: OrbitElements;
  physical: { radius: number; axialTiltDeg: number; dayLengthSec: number; mass: number };
  generation: GenerationData;
  pointsOfInterest: PointOfInterestData[];
  lore: LoreData;
}

export interface BlackHoleData {
  id: string;
  name: string;
  type: 'blackhole';
  parent: string;
  orbit: OrbitElements;
  physical: { schwarzschildRadius: number; diskInner: number; diskOuter: number };
  lore: LoreData;
}

export type BodyData = StarData | PlanetData | BlackHoleData;

/** system.asteroidBelt: the static, instanced rock belt (Day 4). */
export interface AsteroidBeltData {
  count: number;
  /** Belt annulus, world units from the star. */
  innerRadius: number;
  outerRadius: number;
  /** Vertical spread, world units. */
  thickness: number;
  /** Tilt of the belt plane, degrees about +X. */
  inclinationDeg: number;
  /** Rock size range (radius before deformation), world units. */
  minSize: number;
  maxSize: number;
  seed: number;
}

export interface SystemData {
  system: { name: string; seed: number; asteroidBelt: AsteroidBeltData };
  bodies: BodyData[];
}

// ------------------------------------------------------------------ validation

function fail(where: string, message: string): never {
  throw new Error(`planets.json: ${where}: ${message}`);
}

function num(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(where, 'expected a finite number');
  return value;
}

function str(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(where, 'expected a string');
  return value;
}

function obj(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(where, 'expected an object');
  return value as Record<string, unknown>;
}

function lore(value: unknown, where: string): LoreData {
  const o = obj(value, where);
  const trivia = o['trivia'];
  if (!Array.isArray(trivia)) fail(`${where}.trivia`, 'expected an array');
  return {
    title: str(o['title'], `${where}.title`),
    summary: str(o['summary'], `${where}.summary`),
    trivia: trivia.map((t, i) => str(t, `${where}.trivia[${i}]`)),
  };
}

function orbit(value: unknown, where: string): OrbitElements {
  const o = obj(value, where);
  const elements: OrbitElements = {
    a: num(o['a'], `${where}.a`),
    e: num(o['e'], `${where}.e`),
    incDeg: num(o['incDeg'], `${where}.incDeg`),
    periodSec: num(o['periodSec'], `${where}.periodSec`),
    phase: num(o['phase'], `${where}.phase`),
  };
  if (elements.e < 0 || elements.e >= 1) fail(`${where}.e`, 'must be in [0, 1)');
  if (elements.a <= 0 || elements.periodSec <= 0) fail(where, 'a and periodSec must be positive');
  return elements;
}

function generation(value: unknown, where: string): GenerationData {
  const o = obj(value, where);
  const noise = obj(o['noise'], `${where}.noise`);
  const palette = o['palette'];
  if (!Array.isArray(palette) || palette.length !== 3) fail(`${where}.palette`, 'expected three colours');
  const atmosphere = obj(o['atmosphere'], `${where}.atmosphere`);
  return {
    seed: num(o['seed'], `${where}.seed`),
    noise: {
      octaves: num(noise['octaves'], `${where}.noise.octaves`),
      frequency: num(noise['frequency'], `${where}.noise.frequency`),
      amplitude: num(noise['amplitude'], `${where}.noise.amplitude`),
      ridged: noise['ridged'] === true,
    },
    biome: str(o['biome'], `${where}.biome`),
    palette: [
      str(palette[0], `${where}.palette[0]`),
      str(palette[1], `${where}.palette[1]`),
      str(palette[2], `${where}.palette[2]`),
    ],
    atmosphere: {
      color: str(atmosphere['color'], `${where}.atmosphere.color`),
      density: num(atmosphere['density'], `${where}.atmosphere.density`),
    },
    nightLights: o['nightLights'] === true,
  };
}

function pointsOfInterest(value: unknown, where: string): PointOfInterestData[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(where, 'expected an array');
  return value.map((item, i) => {
    const o = obj(item, `${where}[${i}]`);
    const kind = str(o['kind'], `${where}[${i}].kind`);
    if (!POI_KINDS.includes(kind as PointOfInterestKind)) fail(`${where}[${i}].kind`, `must be one of ${POI_KINDS.join(', ')}`);
    return {
      id: str(o['id'], `${where}[${i}].id`),
      name: str(o['name'], `${where}[${i}].name`),
      kind: kind as PointOfInterestKind,
      description: str(o['description'], `${where}[${i}].description`),
    };
  });
}

function body(value: unknown, index: number): BodyData {
  const o = obj(value, `bodies[${index}]`);
  const id = str(o['id'], `bodies[${index}].id`);
  const name = str(o['name'], `${id}.name`);
  const physical = obj(o['physical'], `${id}.physical`);
  const bodyLore = lore(o['lore'], `${id}.lore`);

  switch (o['type']) {
    case 'star':
      return {
        id,
        name,
        type: 'star',
        parent: null,
        physical: {
          radius: num(physical['radius'], `${id}.physical.radius`),
          color: str(physical['color'], `${id}.physical.color`),
          mass: num(physical['mass'], `${id}.physical.mass`),
        },
        lore: bodyLore,
      };
    case 'planet':
      return {
        id,
        name,
        type: 'planet',
        parent: str(o['parent'], `${id}.parent`),
        orbit: orbit(o['orbit'], `${id}.orbit`),
        physical: {
          radius: num(physical['radius'], `${id}.physical.radius`),
          axialTiltDeg: num(physical['axialTiltDeg'], `${id}.physical.axialTiltDeg`),
          dayLengthSec: num(physical['dayLengthSec'], `${id}.physical.dayLengthSec`),
          mass: num(physical['mass'], `${id}.physical.mass`),
        },
        generation: generation(o['generation'], `${id}.generation`),
        pointsOfInterest: pointsOfInterest(o['pointsOfInterest'], `${id}.pointsOfInterest`),
        lore: bodyLore,
      };
    case 'blackhole':
      return {
        id,
        name,
        type: 'blackhole',
        parent: str(o['parent'], `${id}.parent`),
        orbit: orbit(o['orbit'], `${id}.orbit`),
        physical: {
          schwarzschildRadius: num(physical['schwarzschildRadius'], `${id}.physical.schwarzschildRadius`),
          diskInner: num(physical['diskInner'], `${id}.physical.diskInner`),
          diskOuter: num(physical['diskOuter'], `${id}.physical.diskOuter`),
        },
        lore: bodyLore,
      };
    default:
      return fail(`${id}.type`, `unknown body type ${String(o['type'])}`);
  }
}

function asteroidBelt(value: unknown, where: string): AsteroidBeltData {
  const o = obj(value, where);
  const belt: AsteroidBeltData = {
    count: num(o['count'], `${where}.count`),
    innerRadius: num(o['innerRadius'], `${where}.innerRadius`),
    outerRadius: num(o['outerRadius'], `${where}.outerRadius`),
    thickness: num(o['thickness'], `${where}.thickness`),
    inclinationDeg: num(o['inclinationDeg'], `${where}.inclinationDeg`),
    minSize: num(o['minSize'], `${where}.minSize`),
    maxSize: num(o['maxSize'], `${where}.maxSize`),
    seed: num(o['seed'], `${where}.seed`),
  };
  if (belt.innerRadius >= belt.outerRadius) fail(where, 'innerRadius must be less than outerRadius');
  if (belt.minSize > belt.maxSize) fail(where, 'minSize must not exceed maxSize');
  if (!Number.isInteger(belt.count) || belt.count < 0) fail(`${where}.count`, 'must be a whole number');
  return belt;
}

/** Validate an untyped planets.json object. Exported for tests. */
export function parseSystemData(raw: unknown): SystemData {
  const root = obj(raw, 'root');
  const system = obj(root['system'], 'system');
  const bodies = root['bodies'];
  if (!Array.isArray(bodies)) fail('bodies', 'expected an array');

  const data: SystemData = {
    system: {
      name: str(system['name'], 'system.name'),
      seed: num(system['seed'], 'system.seed'),
      asteroidBelt: asteroidBelt(system['asteroidBelt'], 'system.asteroidBelt'),
    },
    bodies: bodies.map(body),
  };

  const ids = new Set<string>();
  for (const b of data.bodies) {
    if (ids.has(b.id)) fail(b.id, 'duplicate id');
    ids.add(b.id);
  }
  for (const b of data.bodies) {
    if (b.parent !== null && !ids.has(b.parent)) fail(`${b.id}.parent`, `no body with id "${b.parent}"`);
  }
  if (!data.bodies.some((b) => b.type === 'star')) fail('bodies', 'the system needs a star');
  return data;
}

let cached: SystemData | null = null;

/** The validated system, parsed once. */
export function loadSystemData(): SystemData {
  cached ??= parseSystemData(rawSystem);
  return cached;
}
