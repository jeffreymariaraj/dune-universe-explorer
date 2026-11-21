import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { impactDamage, raySphere, resolveContact, sphereSphere } from './collision';

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

describe('sphereSphere', () => {
  it('reports overlap depth and a normal pointing from b to a', () => {
    const contact = sphereSphere(v(3, 0, 0), 2, v(0, 0, 0), 2);
    expect(contact).not.toBeNull();
    expect(contact!.depth).toBeCloseTo(1, 12);
    expect(contact!.normal.toArray()).toEqual([1, 0, 0]);
    expect(contact!.point.toArray()).toEqual([2, 0, 0]);
  });

  it('returns null when the spheres only just miss or touch', () => {
    expect(sphereSphere(v(4, 0, 0), 2, v(0, 0, 0), 2)).toBeNull();
    expect(sphereSphere(v(10, 10, 10), 1, v(0, 0, 0), 1)).toBeNull();
  });

  it('handles concentric spheres without NaNs', () => {
    const contact = sphereSphere(v(1, 1, 1), 1, v(1, 1, 1), 1)!;
    expect(contact.normal.length()).toBeCloseTo(1, 12);
    expect(contact.depth).toBe(2);
  });
});

describe('raySphere', () => {
  it('hits the near surface', () => {
    expect(raySphere(v(0, 0, 10), v(0, 0, -1), v(0, 0, 0), 2)).toBeCloseTo(8, 12);
  });

  it('misses when pointing away or passing wide', () => {
    expect(raySphere(v(0, 0, 10), v(0, 0, 1), v(0, 0, 0), 2)).toBeNull();
    expect(raySphere(v(5, 0, 10), v(0, 0, -1), v(0, 0, 0), 2)).toBeNull();
  });

  it('returns the exit distance from inside', () => {
    expect(raySphere(v(0, 0, 0), v(1, 0, 0), v(0, 0, 0), 3)).toBeCloseTo(3, 12);
  });
});

describe('resolveContact', () => {
  const contact = () => ({ normal: v(0, 1, 0), depth: 0.5, point: v(0, 0, 0) });

  it('pushes the body out of the overlap', () => {
    const position = v(0, -0.5, 0);
    resolveContact(position, v(0, 0, 0), contact(), 0.5, 0);
    expect(position.y).toBeCloseTo(0, 12);
  });

  it('reflects the normal velocity scaled by restitution and keeps the tangent', () => {
    const velocity = v(3, -10, 0);
    const { impactSpeed } = resolveContact(v(0, 0, 0), velocity, contact(), 0.4, 0);
    expect(impactSpeed).toBeCloseTo(10, 12);
    expect(velocity.y).toBeCloseTo(4, 12);
    expect(velocity.x).toBeCloseTo(3, 12);
  });

  it('applies friction to the tangential part only', () => {
    const velocity = v(10, -10, 0);
    resolveContact(v(0, 0, 0), velocity, contact(), 0, 0.5);
    expect(velocity.x).toBeCloseTo(5, 12);
    expect(velocity.y).toBeCloseTo(0, 12);
  });

  it('ignores a body that is already separating', () => {
    const velocity = v(0, 5, 0);
    expect(resolveContact(v(0, 0, 0), velocity, contact(), 0.5, 0.5).impactSpeed).toBe(0);
    expect(velocity.y).toBe(5);
  });

  it('works on the relative velocity of a moving body', () => {
    // A planet moving up at 20 hits a ship at rest: the ship is thrown upward.
    const velocity = v(0, 0, 0);
    const { impactSpeed } = resolveContact(v(0, 0, 0), velocity, contact(), 0.5, 0, v(0, 20, 0));
    expect(impactSpeed).toBeCloseTo(20, 12);
    expect(velocity.y).toBeCloseTo(30, 12); // 20 + 0.5 * 20
  });
});

describe('impactDamage', () => {
  it('is zero for scrapes and linear above the threshold', () => {
    expect(impactDamage(5, 8, 0.5)).toBe(0);
    expect(impactDamage(28, 8, 0.5)).toBe(10);
  });
});
