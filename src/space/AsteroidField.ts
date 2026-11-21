// Day 4. Unit I: display lists — an InstancedMesh is the modern equivalent of
// compiling geometry once and reusing it, which is how 2,000 asteroids cost ONE
// draw call. Unit V: collision broad phase (Octree) and object shape.
//
// One noise-deformed icosahedron is shared by every instance; variety comes
// from a per-instance transform (position, random orientation, non-uniform
// scale) and a per-instance colour. Each rock tumbles about its own axis.
//
// The belt sits in the wide gap between Giedi Prime's and Kaitain's orbits;
// its count, radii, size range and seed are system.asteroidBelt in planets.json.
// It does not orbit: the rocks are static in the belt's frame, so the octree is
// built once at load and never updated. Tumbling is visual only — collision
// uses each rock's bounding sphere, which does not change when it rotates.
//
// Everything is seeded, so the belt is identical on every run.

import * as THREE from 'three';
import { Octree } from '../physics/Octree';
import { sphereSphere, type Contact } from '../physics/collision';
import type { AsteroidBeltData } from '../data/systemData';
import { createRandom, fbm } from '../physics/noise';

/** The belt's settings come from system.asteroidBelt in planets.json. */
export type BeltConfig = AsteroidBeltData;

/** Within this distance of the belt the detailed (320-triangle) rocks are drawn. */
const NEAR_DETAIL_DISTANCE = 2500;

export interface AsteroidContact extends Contact {
  id: number;
}

export class AsteroidField {
  readonly mesh: THREE.InstancedMesh;
  /** The belt's frame: rocks are placed in it; it is tilted by the inclination. */
  readonly root = new THREE.Group();
  readonly octree: Octree;
  readonly config: BeltConfig;

  // Per-instance data, belt-local.
  private readonly centres: THREE.Vector3[] = [];
  private readonly radii: number[] = [];
  private readonly scales: THREE.Vector3[] = [];
  private readonly baseRotations: THREE.Quaternion[] = [];
  private readonly spinAxes: THREE.Vector3[] = [];
  private readonly spinRates: number[] = [];

  private readonly worldToBelt = new THREE.Matrix4();
  private readonly beltToWorld = new THREE.Matrix4();
  private readonly candidates: number[] = [];
  private readonly localCentre = new THREE.Vector3();
  private readonly worldCentre = new THREE.Vector3();

  private readonly nearGeometry: THREE.BufferGeometry;
  private readonly farGeometry: THREE.BufferGeometry;
  private readonly cameraLocal = new THREE.Vector3();
  private tumbled = false;

  // Scratch for the per-frame tumble.
  private readonly spin = new THREE.Quaternion();
  private readonly rotation = new THREE.Quaternion();
  private readonly matrix = new THREE.Matrix4();

  constructor(config: BeltConfig) {
    this.config = config;
    this.root.name = 'AsteroidBelt';
    this.root.rotation.x = THREE.MathUtils.degToRad(config.inclinationDeg);
    this.root.updateMatrixWorld(true);
    this.beltToWorld.copy(this.root.matrixWorld);
    this.worldToBelt.copy(this.beltToWorld).invert();

    // Day 10 perf pass: two levels of detail for the one shared rock shape.
    // From far away (most of the game) the belt draws 20-triangle rocks:
    // 40k triangles instead of 640k, still one draw call.
    const near = buildRockGeometry(config.seed, 2);
    const far = buildRockGeometry(config.seed, 0);
    this.nearGeometry = near.geometry;
    this.farGeometry = far.geometry;
    const geometry = this.farGeometry;
    const shapeRadius = Math.max(near.shapeRadius, far.shapeRadius);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, // tinted per instance
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true, // faceted rock: one normal per triangle
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, config.count);
    this.mesh.name = 'Asteroids';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // rewritten every frame

    const extent = config.outerRadius + config.maxSize * 2;
    this.octree = new Octree(
      new THREE.Box3(new THREE.Vector3(-extent, -extent, -extent), new THREE.Vector3(extent, extent, extent)),
      7,
      8,
    );

    this.scatter(shapeRadius);
    this.root.add(this.mesh);
  }

  /**
   * Narrow phase for a sphere in WORLD space: octree query in the belt's frame,
   * then sphere-vs-sphere on the few candidates. Contacts come back in world space.
   */
  collideSphere(centre: THREE.Vector3, radius: number, out: AsteroidContact[] = []): AsteroidContact[] {
    out.length = 0;
    this.localCentre.copy(centre).applyMatrix4(this.worldToBelt);
    this.octree.query(this.localCentre, radius, this.candidates);
    for (const id of this.candidates) {
      this.worldCentre.copy(this.centres[id]!).applyMatrix4(this.beltToWorld);
      const contact = sphereSphere(centre, radius, this.worldCentre, this.radii[id]!);
      if (contact) out.push({ id, ...contact });
    }
    return out;
  }

  /** World-space collision spheres of the rocks within `radius` of a point (X-Ray). */
  nearbySpheres(centre: THREE.Vector3, radius: number, out: THREE.Sphere[]): void {
    this.localCentre.copy(centre).applyMatrix4(this.worldToBelt);
    this.octree.query(this.localCentre, radius, this.candidates);
    for (const id of this.candidates) {
      out.push(new THREE.Sphere(this.centres[id]!.clone().applyMatrix4(this.beltToWorld), this.radii[id]!));
    }
  }

  /** World-space centre of the belt annulus at angle 0, for "jump to". */
  pointOnBelt(radius: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(radius, 0, 0).applyMatrix4(this.beltToWorld);
  }

  /**
   * Per rendered frame: choose the rock detail by the camera's distance from
   * the belt, and (near the belt only) tumble the rocks. Visual only.
   */
  updateTumble(time: number, cameraPosition?: THREE.Vector3): void {
    let distance = 0;
    if (cameraPosition) {
      // Distance from the camera to the belt's ring-shaped volume, in its own frame.
      this.cameraLocal.copy(cameraPosition).applyMatrix4(this.worldToBelt);
      const radial = Math.hypot(this.cameraLocal.x, this.cameraLocal.z);
      const outside = Math.max(0, this.config.innerRadius - radial, radial - this.config.outerRadius);
      distance = Math.hypot(outside, Math.max(0, Math.abs(this.cameraLocal.y) - this.config.thickness * 1.5));
    }
    const near = distance < NEAR_DETAIL_DISTANCE;
    const geometry = near ? this.nearGeometry : this.farGeometry;
    if (this.mesh.geometry !== geometry) this.mesh.geometry = geometry;
    if (!near && this.tumbled) return; // nobody can see a rock turn from out there
    this.tumbled = true;

    for (let i = 0; i < this.config.count; i++) {
      this.spin.setFromAxisAngle(this.spinAxes[i]!, this.spinRates[i]! * time);
      this.rotation.multiplyQuaternions(this.spin, this.baseRotations[i]!);
      this.matrix.compose(this.centres[i]!, this.rotation, this.scales[i]!);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.nearGeometry.dispose();
    this.farGeometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.octree.clear();
  }

  // ------------------------------------------------------------------ building

  private scatter(shapeRadius: number): void {
    const { count, innerRadius, outerRadius, thickness, minSize, maxSize } = this.config;
    const random = createRandom(this.config.seed);
    const colour = new THREE.Color();
    const dark = new THREE.Color('#4a4038');
    const light = new THREE.Color('#9a8a78');

    for (let i = 0; i < count; i++) {
      // Radius: triangular distribution (sum of two uniforms) so the belt is
      // densest in the middle and thins out at its edges.
      const t = (random() + random()) / 2;
      const r = innerRadius + (outerRadius - innerRadius) * t;
      const angle = random() * Math.PI * 2;
      // Height: also bunched towards the plane.
      const y = (random() + random() + random() - 1.5) * thickness;
      const centre = new THREE.Vector3(Math.cos(angle) * r, y, -Math.sin(angle) * r);

      // Size: mostly small rocks, a few big ones (power law).
      const size = minSize + (maxSize - minSize) * random() ** 3;
      const scale = new THREE.Vector3(
        size * (0.7 + random() * 0.6),
        size * (0.6 + random() * 0.5),
        size * (0.7 + random() * 0.6),
      );
      // Bounding sphere of the deformed, stretched rock (collision radius).
      const radius = shapeRadius * Math.max(scale.x, scale.y, scale.z);

      const base = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2),
      );
      const axis = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
      // Small rocks tumble faster than big ones.
      const rate = (0.05 + random() * 0.4) * (minSize / size) ** 0.5;

      this.centres.push(centre);
      this.radii.push(radius);
      this.scales.push(scale);
      this.baseRotations.push(base);
      this.spinAxes.push(axis);
      this.spinRates.push(rate);
      this.octree.insert(i, centre, radius);

      colour.copy(dark).lerp(light, random());
      this.mesh.setColorAt(i, colour);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.updateTumble(0);
    this.mesh.computeBoundingSphere();
  }
}

/**
 * The one rock shape: an icosahedron (detail 2, 320 triangles) whose vertices
 * are pushed in and out by FBM noise. Icosahedron vertices are duplicated per
 * face, but duplicates share a position and so get the same displacement: no
 * cracks.
 */
function buildRockGeometry(seed: number, detail: number): { geometry: THREE.BufferGeometry; shapeRadius: number } {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const position = geometry.getAttribute('position');
  const offset = (seed % 97) * 1.3;
  const p = new THREE.Vector3();
  let shapeRadius = 0;
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).normalize();
    const bump = fbm(p.x * 1.6 + offset, p.y * 1.6, p.z * 1.6 - offset, 4, false);
    const r = 1 + 0.32 * bump;
    p.multiplyScalar(r);
    position.setXYZ(i, p.x, p.y, p.z);
    shapeRadius = Math.max(shapeRadius, r);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, shapeRadius };
}
