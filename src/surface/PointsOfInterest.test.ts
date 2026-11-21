import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PointsOfInterest } from './PointsOfInterest';

const items = [
  { id: 'a', name: 'A', kind: 'monolith' as const, description: '' },
  { id: 'b', name: 'B', kind: 'beacon' as const, description: '' },
  { id: 'c', name: 'C', kind: 'ruin' as const, description: '' },
];

describe('PointsOfInterest', () => {
  it('places every landmark on the ground, 90-260 u from the landing point, deterministically', () => {
    const ground = (x: number, z: number): number => 0.01 * x + 0.02 * z;
    const first = new PointsOfInterest(items, ground, 42);
    const second = new PointsOfInterest(items, ground, 42);
    first.placed.forEach((poi, i) => {
      const d = Math.hypot(poi.position.x, poi.position.z);
      expect(d).toBeGreaterThanOrEqual(90);
      expect(d).toBeLessThanOrEqual(260);
      expect(poi.position.y).toBeCloseTo(ground(poi.position.x, poi.position.z), 12);
      expect(poi.position.equals(second.placed[i]!.position)).toBe(true);
    });
    first.dispose();
    second.dispose();
  });

  it('reports bearing: 0 ahead, positive to the right', () => {
    const pois = new PointsOfInterest([items[0]!], () => 0, 1);
    const target = pois.placed[0]!.position;
    // Stand south of it facing north (-Z): straight ahead.
    const viewer = new THREE.Vector3(target.x, 0, target.z + 50);
    expect(pois.nearest(viewer, 0)!.bearing).toBeCloseTo(0, 9);
    // Stand west of it facing north: it is to the right (+90 degrees).
    const west = new THREE.Vector3(target.x - 50, 0, target.z);
    expect(pois.nearest(west, 0)!.bearing).toBeCloseTo(Math.PI / 2, 9);
    expect(pois.nearest(west, 0)!.distance).toBeCloseTo(50, 9);
    pois.dispose();
  });
});
