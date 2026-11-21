import { describe, expect, it } from 'vitest';
import rawSystem from './planets.json';
import { loadSystemData, parseSystemData } from './systemData';

describe('planets.json', () => {
  it('parses into one star and six planets with valid orbits', () => {
    const data = loadSystemData();
    expect(data.bodies.filter((b) => b.type === 'star')).toHaveLength(1);
    const planets = data.bodies.filter((b) => b.type === 'planet');
    expect(planets.map((p) => p.id)).toEqual(['arrakis', 'caladan', 'giedi-prime', 'kaitain', 'salusa-secundus', 'ix']);
    for (const planet of planets) {
      expect(planet.orbit.e).toBeGreaterThanOrEqual(0);
      expect(planet.orbit.e).toBeLessThan(1);
      expect(planet.generation.palette).toHaveLength(3);
    }
  });

  it('keeps every orbit clear of the star and of its neighbours', () => {
    const data = loadSystemData();
    const star = data.bodies.find((b) => b.type === 'star');
    const planets = data.bodies.flatMap((b) => (b.type === 'planet' ? [b] : []));
    if (!star || star.type !== 'star') throw new Error('no star');
    for (const planet of planets) {
      expect(planet.orbit.a * (1 - planet.orbit.e) - planet.physical.radius).toBeGreaterThan(star.physical.radius * 3);
    }
    for (let i = 1; i < planets.length; i++) {
      const inner = planets[i - 1]!;
      const outer = planets[i]!;
      // Inner aphelion must stay inside outer perihelion, with room for both planets.
      const gap = outer.orbit.a * (1 - outer.orbit.e) - inner.orbit.a * (1 + inner.orbit.e);
      expect(gap).toBeGreaterThan(inner.physical.radius + outer.physical.radius);
    }
  });

  it('rejects broken data with the body id in the message', () => {
    const broken = structuredClone(rawSystem) as { bodies: Array<{ orbit?: { e: number } }> };
    broken.bodies[1]!.orbit!.e = 1.2;
    expect(() => parseSystemData(broken)).toThrow(/arrakis\.orbit\.e/);
  });

  it('rejects a body whose parent does not exist', () => {
    const broken = structuredClone(rawSystem) as { bodies: Array<{ parent: string | null }> };
    broken.bodies[2]!.parent = 'nowhere';
    expect(() => parseSystemData(broken)).toThrow(/caladan\.parent/);
  });
});

describe('system.asteroidBelt', () => {
  it('loads the belt from planets.json and keeps it between Giedi Prime and Kaitain', () => {
    const data = loadSystemData();
    const belt = data.system.asteroidBelt;
    expect(belt.count).toBe(2000);
    const orbitOf = (id: string) => {
      const body = data.bodies.find((b) => b.id === id);
      if (!body || body.type !== 'planet') throw new Error(id);
      return body.orbit;
    };
    const giedi = orbitOf('giedi-prime');
    const kaitain = orbitOf('kaitain');
    expect(belt.innerRadius).toBeGreaterThan(giedi.a * (1 + giedi.e));
    expect(belt.outerRadius).toBeLessThan(kaitain.a * (1 - kaitain.e));
  });

  it('rejects a belt whose inner radius is outside its outer radius', () => {
    const broken = structuredClone(rawSystem) as { system: { asteroidBelt: { innerRadius: number } } };
    broken.system.asteroidBelt.innerRadius = 99_999;
    expect(() => parseSystemData(broken)).toThrow(/asteroidBelt/);
  });
});

describe('points of interest', () => {
  it('gives every planet two or three landmarks of a known kind', () => {
    for (const body of loadSystemData().bodies) {
      if (body.type !== 'planet') continue;
      expect(body.pointsOfInterest.length).toBeGreaterThanOrEqual(2);
      expect(body.pointsOfInterest.length).toBeLessThanOrEqual(3);
    }
  });

  it('rejects an unknown kind', () => {
    const broken = structuredClone(rawSystem) as { bodies: Array<{ pointsOfInterest?: Array<{ kind: string }> }> };
    broken.bodies[1]!.pointsOfInterest![0]!.kind = 'castle';
    expect(() => parseSystemData(broken)).toThrow(/pointsOfInterest\[0\]\.kind/);
  });
});
