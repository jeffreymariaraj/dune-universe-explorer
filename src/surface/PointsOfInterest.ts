// Day 8. Unit V: object shape (procedural models) and object hierarchies.
//
// Two or three landmarks per planet, from `pointsOfInterest` in planets.json
// (name, kind, description). They are placed around wherever you land, at
// seeded bearings and distances, standing on the heightfield, so the same
// landing always finds them in the same places.
//
// No model files: each kind is a small hierarchy of three.js primitives
// (boxes, cylinders, cones) under one group, plus a tall, faint light beam so
// it can be found from a distance through the fog. Beacons pulse.

import * as THREE from 'three';
import type { PointOfInterestData, PointOfInterestKind } from '../data/systemData';
import { createRandom } from '../physics/noise';

export interface PlacedPointOfInterest {
  data: PointOfInterestData;
  /** Ground position of its base. */
  position: THREE.Vector3;
  group: THREE.Group;
}

/** Bearing and distance from a viewer to the nearest landmark. */
export interface PointOfInterestFix {
  poi: PlacedPointOfInterest;
  distance: number;
  /** Radians, 0 = straight ahead, positive = to the right. */
  bearing: number;
}

export class PointsOfInterest {
  readonly root = new THREE.Group();
  readonly placed: PlacedPointOfInterest[] = [];

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly beaconMaterials: THREE.MeshBasicMaterial[] = [];

  constructor(items: readonly PointOfInterestData[], groundAt: (x: number, z: number) => number, seed: number) {
    this.root.name = 'PointsOfInterest';
    const random = createRandom(seed ^ 0x9017);
    const startAngle = random() * Math.PI * 2;

    items.forEach((data, index) => {
      // Spread evenly round the landing point, 90-260 u away, with some jitter.
      const angle = startAngle + (index / items.length) * Math.PI * 2 + (random() - 0.5) * 0.8;
      const distance = 90 + random() * 170;
      const x = Math.sin(angle) * distance;
      const z = -Math.cos(angle) * distance;
      const position = new THREE.Vector3(x, groundAt(x, z), z);

      const group = this.build(data.kind, random);
      group.name = `poi:${data.id}`;
      group.position.copy(position);
      group.rotation.y = random() * Math.PI * 2;
      this.root.add(group);
      this.placed.push({ data, position, group });
    });
  }

  /** Nearest landmark to a viewer at `position` facing `yaw` (0 = -Z). */
  nearest(position: THREE.Vector3, yaw: number): PointOfInterestFix | null {
    let best: PointOfInterestFix | null = null;
    for (const poi of this.placed) {
      const dx = poi.position.x - position.x;
      const dz = poi.position.z - position.z;
      const distance = Math.hypot(dx, dz);
      if (best && distance >= best.distance) continue;
      // Angle of the target measured like yaw (0 = -Z, counter-clockwise),
      // then relative to the facing; positive bearing = to the right.
      const targetYaw = Math.atan2(-dx, -dz);
      let bearing = yaw - targetYaw;
      bearing = Math.atan2(Math.sin(bearing), Math.cos(bearing));
      best = { poi, distance, bearing };
    }
    return best;
  }

  /** Pulse the beacons (visual only, render time). */
  animate(time: number): void {
    const pulse = 0.55 + 0.45 * Math.sin(time * 3);
    for (const material of this.beaconMaterials) material.color.setScalar(1).multiplyScalar(1.5 + 2.5 * pulse);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.beaconMaterials.length = 0;
    this.placed.length = 0;
    this.root.removeFromParent();
    this.root.clear();
  }

  // ------------------------------------------------------------------ models

  private build(kind: PointOfInterestKind, random: () => number): THREE.Group {
    const group = new THREE.Group();
    const metal = this.material(new THREE.MeshStandardMaterial({ color: 0x6d6a66, metalness: 0.6, roughness: 0.55 }));
    const stone = this.material(new THREE.MeshStandardMaterial({ color: 0x8a7a68, roughness: 0.95 }));
    const dark = this.material(new THREE.MeshStandardMaterial({ color: 0x1b1b20, metalness: 0.3, roughness: 0.35 }));

    switch (kind) {
      case 'wreck': {
        // A tilted hull half sunk in the ground, a broken boom and a fin.
        const hull = this.mesh(new THREE.CylinderGeometry(3.2, 4, 18, 10), metal);
        hull.rotation.set(Math.PI / 2 - 0.25, 0, 0.3);
        hull.position.y = 1.5;
        const boom = this.mesh(new THREE.BoxGeometry(1, 1, 12), metal);
        boom.position.set(4, 3.5, 2);
        boom.rotation.set(0.5, 0.4, 0);
        const fin = this.mesh(new THREE.BoxGeometry(0.4, 4, 3), dark);
        fin.position.set(-1, 5, -6);
        group.add(hull, boom, fin);
        break;
      }
      case 'monolith': {
        const slab = this.mesh(new THREE.BoxGeometry(3, 16, 1.2), dark);
        slab.position.y = 7.5;
        const plinth = this.mesh(new THREE.BoxGeometry(6, 1, 4), stone);
        plinth.position.y = 0.2;
        group.add(slab, plinth);
        break;
      }
      case 'beacon': {
        const pole = this.mesh(new THREE.CylinderGeometry(0.18, 0.3, 7, 8), metal);
        pole.position.y = 3.5;
        const light = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.materials.push(light);
        this.beaconMaterials.push(light);
        const lamp = this.mesh(new THREE.SphereGeometry(0.5, 16, 12), light);
        lamp.position.y = 7.3;
        group.add(pole, lamp);
        break;
      }
      case 'ruin': {
        // A broken ring of pillars of uneven height.
        const pillars = 7;
        for (let i = 0; i < pillars; i++) {
          if (random() < 0.2) continue; // a gap where one has fallen
          const height = 2 + random() * 7;
          const pillar = this.mesh(new THREE.CylinderGeometry(0.7, 0.85, height, 8), stone);
          const a = (i / pillars) * Math.PI * 2;
          pillar.position.set(Math.cos(a) * 7, height / 2 - 0.3, Math.sin(a) * 7);
          pillar.rotation.z = (random() - 0.5) * 0.15;
          group.add(pillar);
        }
        break;
      }
      case 'spire': {
        const spire = this.mesh(new THREE.ConeGeometry(3, 22, 7), dark);
        spire.position.y = 10;
        spire.rotation.z = 0.08;
        group.add(spire);
        break;
      }
    }

    // A faint beam so landmarks can be found through the fog (bloom makes it glow).
    const beamMaterial = this.material(
      new THREE.MeshBasicMaterial({
        color: 0xffe2a8,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    const beam = this.mesh(new THREE.CylinderGeometry(0.35, 0.35, 120, 8, 1, true), beamMaterial);
    beam.position.y = 60;
    group.add(beam);
    return group;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    this.geometries.push(geometry);
    return new THREE.Mesh(geometry, material);
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }
}
