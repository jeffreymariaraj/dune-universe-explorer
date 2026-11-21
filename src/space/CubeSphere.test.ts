import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCubeSphere, cubeSphereTriangles, spherify } from './CubeSphere';

describe('cube-sphere', () => {
  it('puts every vertex on the unit sphere', () => {
    const geometry = buildCubeSphere(12);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const length = Math.hypot(position.getX(i), position.getY(i), position.getZ(i));
      expect(length).toBeCloseTo(1, 6);
    }
  });

  it('has the expected triangle count (top LOD near the 40k budget)', () => {
    expect(buildCubeSphere(8).getIndex()!.count / 3).toBe(cubeSphereTriangles(8));
    expect(cubeSphereTriangles(56)).toBeGreaterThan(30_000);
    expect(cubeSphereTriangles(56)).toBeLessThanOrEqual(40_000);
  });

  it('winds every triangle counter-clockwise seen from outside', () => {
    const geometry = buildCubeSphere(10);
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex()!;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (let t = 0; t < index.count; t += 3) {
      a.fromBufferAttribute(position, index.getX(t));
      b.fromBufferAttribute(position, index.getX(t + 1));
      c.fromBufferAttribute(position, index.getX(t + 2));
      normal.subVectors(b, a).cross(c.clone().sub(a));
      // Outward: the face normal agrees with the direction to the centroid.
      expect(normal.dot(a.add(b).add(c))).toBeGreaterThan(0);
    }
  });

  it('spreads vertices more evenly than plain normalisation', () => {
    // Edge length at a face centre vs at a face corner, along one row.
    const spread = (map: (x: number, y: number) => THREE.Vector3): number => {
      const step = 0.1;
      const centre = map(0, 0).distanceTo(map(step, 0));
      const edge = map(1 - step, 1 - step).distanceTo(map(1, 1 - step));
      return Math.max(centre, edge) / Math.min(centre, edge);
    };
    const spherified = spread((x, y) => spherify(x, y, 1));
    const normalised = spread((x, y) => new THREE.Vector3(x, y, 1).normalize());
    expect(spherified).toBeLessThan(normalised);
  });
});
