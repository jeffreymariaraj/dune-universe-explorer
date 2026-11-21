import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Octree } from './Octree';

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Sphere {
  centre: THREE.Vector3;
  radius: number;
}

function scatter(count: number, extent: number, maxRadius: number, seed: number): Sphere[] {
  const rand = random(seed);
  return Array.from({ length: count }, () => ({
    centre: new THREE.Vector3((rand() - 0.5) * extent, (rand() - 0.5) * extent, (rand() - 0.5) * extent),
    // Mostly small, a few large: the case a plain octree handles badly.
    radius: 0.5 + rand() ** 4 * maxRadius,
  }));
}

function build(spheres: Sphere[], extent: number): Octree {
  const half = extent / 2;
  const tree = new Octree(new THREE.Box3(new THREE.Vector3(-half, -half, -half), new THREE.Vector3(half, half, half)), 6, 8);
  spheres.forEach((s, id) => tree.insert(id, s.centre, s.radius));
  return tree;
}

function bruteForce(spheres: Sphere[], centre: THREE.Vector3, radius: number): number[] {
  return spheres
    .map((s, id) => ({ s, id }))
    .filter(({ s }) => s.centre.distanceTo(centre) < s.radius + radius)
    .map(({ id }) => id);
}

describe('Octree', () => {
  const extent = 2000;
  const spheres = scatter(2000, extent, 60, 42);
  const tree = build(spheres, extent);

  it('returns exactly what brute force returns', () => {
    const rand = random(7);
    for (let q = 0; q < 300; q++) {
      const centre = new THREE.Vector3((rand() - 0.5) * extent, (rand() - 0.5) * extent, (rand() - 0.5) * extent);
      const radius = 1 + rand() * 120;
      const found = tree.query(centre, radius).sort((a, b) => a - b);
      expect(found).toEqual(bruteForce(spheres, centre, radius));
    }
  });

  it('stores every object exactly once', () => {
    let stored = 0;
    tree.forEachCell((cell) => {
      stored += cell.itemCount;
    });
    expect(stored).toBe(spheres.length);
    expect(tree.size).toBe(spheres.length);
  });

  it('subdivides, and respects the depth limit', () => {
    let deepest = 0;
    let cells = 0;
    tree.forEachCell((cell) => {
      deepest = Math.max(deepest, cell.depth);
      cells++;
    });
    expect(cells).toBeGreaterThan(8);
    expect(deepest).toBeLessThanOrEqual(6);
  });

  it('reuses and clears the output array', () => {
    const out = [999];
    tree.query(new THREE.Vector3(1e6, 0, 0), 1, out);
    expect(out).toEqual([]);
  });

  it('clear() empties the tree', () => {
    const small = build(scatter(50, 100, 5, 3), 100);
    small.clear();
    expect(small.size).toBe(0);
    expect(small.query(new THREE.Vector3(), 1000)).toEqual([]);
  });
});
