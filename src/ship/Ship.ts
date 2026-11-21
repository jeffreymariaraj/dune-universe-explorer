// Unit IV: 3D transforms. Unit V: object hierarchies and kinematic state.
//
// The ship separates SIMULATION STATE from the RENDERED TRANSFORM:
//   * position / velocity / orientation / angularVelocity advance on the fixed
//     1/120 s step and are the only truth for physics and collision.
//   * root.position / root.quaternion are written once per frame by
//     applyInterpolated(alpha), blending the previous and current physics states.
// That is what keeps motion smooth at any frame rate without ever running
// physics in the render callback.
//
// Model: Quaternius LowPoly Spaceships (CC0) at public/models/ship.glb.
// If it is missing, we build a cone so the game still flies.

import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';

/** Local forward is -Z, matching three.js camera convention. */
export const SHIP_FORWARD = new THREE.Vector3(0, 0, -1);
export const SHIP_UP = new THREE.Vector3(0, 1, 0);
export const SHIP_RIGHT = new THREE.Vector3(1, 0, 0);

const MODEL_URL = '/models/ship.glb';
/** Longest dimension the loaded model is normalised to, in world units. */
const TARGET_LENGTH = 6;

export class Ship {
  readonly root = new THREE.Group();

  // --- simulation state (fixed step) ---
  readonly position = new THREE.Vector3(0, 0, 0);
  readonly velocity = new THREE.Vector3(0, 0, 0);
  readonly orientation = new THREE.Quaternion();
  /** Body-frame angular velocity, rad/s. */
  readonly angularVelocity = new THREE.Vector3(0, 0, 0);

  // --- previous state, for render interpolation ---
  private readonly prevPosition = new THREE.Vector3();
  private readonly prevOrientation = new THREE.Quaternion();

  /** Collision radius, filled in from the model bounds (Unit V: narrow phase). */
  boundingRadius = TARGET_LENGTH * 0.5;
  /** Hull integrity, 0..maxHull. Collisions subtract from it (Day 4). */
  hull = 100;
  readonly maxHull = 100;

  /** True when the real glTF model loaded, false when flying the fallback cone. */
  usingFallbackModel = true;

  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  constructor() {
    this.root.name = 'Ship';
  }

  async load(assets: AssetLoader): Promise<void> {
    const gltf = await assets.loadGLTF(MODEL_URL);
    const model = gltf ? gltf.scene : null;

    if (model) {
      this.usingFallbackModel = false;
      this.normaliseModel(model);
      this.root.add(model);
    } else {
      this.usingFallbackModel = true;
      this.root.add(this.buildFallbackMesh());
    }

    // Unit V: object hierarchy — children inherit the ship's transform.
    this.root.add(this.buildNavigationLights());
    this.syncRenderTransform();
  }

  get speed(): number {
    return this.velocity.length();
  }

  /** World-space forward direction. */
  getForward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(SHIP_FORWARD).applyQuaternion(this.orientation);
  }

  getUp(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(SHIP_UP).applyQuaternion(this.orientation);
  }

  /**
   * World-space engine nozzle, from the SIMULATION state (fixed step).
   * The tail sits at +Z in the ship's frame, just inside the bounding radius.
   */
  getNozzle(out = new THREE.Vector3()): THREE.Vector3 {
    return out
      .set(0, 0, this.boundingRadius * 0.9)
      .applyQuaternion(this.orientation)
      .add(this.position);
  }

  /** Call at the top of every fixed step, before the controller integrates. */
  saveState(): void {
    this.prevPosition.copy(this.position);
    this.prevOrientation.copy(this.orientation);
  }

  /**
   * Call once per rendered frame. `alpha` is the engine's leftover accumulator
   * fraction: 0 means "show the previous step", 1 means "show the current one".
   */
  applyInterpolated(alpha: number): void {
    this.root.position.lerpVectors(this.prevPosition, this.position, alpha);
    this.root.quaternion.slerpQuaternions(this.prevOrientation, this.orientation, alpha);
  }

  /** Snap the rendered transform to the simulation state (used after teleports). */
  syncRenderTransform(): void {
    this.prevPosition.copy(this.position);
    this.prevOrientation.copy(this.orientation);
    this.root.position.copy(this.position);
    this.root.quaternion.copy(this.orientation);
  }

  // ------------------------------------------------------------------ geometry

  /** Centre the model, scale it to TARGET_LENGTH, and measure its radius. */
  private normaliseModel(model: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const scale = TARGET_LENGTH / longest;

    model.position.sub(centre);
    model.scale.setScalar(scale);
    model.position.multiplyScalar(scale);
    this.boundingRadius = (longest * scale) / 2;

    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = false;
      }
    });
  }

  /**
   * Fallback hull, used when public/models/ship.glb is missing: a tapered cone
   * nose pointing down local -Z, swept wings, and an emissive engine bell at the
   * tail — which is what the chase camera actually looks at, so the stand-in
   * still reads as a ship from behind.
   */
  private buildFallbackMesh(): THREE.Object3D {
    const group = new THREE.Group();
    group.name = 'FallbackHull';

    const hullMaterial = new THREE.MeshStandardMaterial({
      color: 0xb9c3cf,
      metalness: 0.55,
      roughness: 0.4,
      flatShading: true,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0x5c6774,
      metalness: 0.5,
      roughness: 0.55,
      flatShading: true,
    });

    // ConeGeometry points along +Y; -90 degrees about X aims it at -Z (forward).
    const noseGeometry = new THREE.ConeGeometry(TARGET_LENGTH * 0.16, TARGET_LENGTH * 1.05, 12);
    noseGeometry.rotateX(-Math.PI / 2);
    noseGeometry.translate(0, 0, -TARGET_LENGTH * 0.1);
    group.add(new THREE.Mesh(noseGeometry, hullMaterial));

    // Swept wings: one box per side, rolled outwards and angled back.
    const wingGeometry = new THREE.BoxGeometry(
      TARGET_LENGTH * 0.46,
      TARGET_LENGTH * 0.04,
      TARGET_LENGTH * 0.3,
    );
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(wingGeometry, trimMaterial);
      wing.position.set(side * TARGET_LENGTH * 0.3, 0, TARGET_LENGTH * 0.18);
      wing.rotation.z = side * -0.25;
      wing.rotation.y = side * 0.22;
      group.add(wing);
    }

    // Tail fin, so roll is readable against the starfield.
    const finGeometry = new THREE.BoxGeometry(
      TARGET_LENGTH * 0.04,
      TARGET_LENGTH * 0.26,
      TARGET_LENGTH * 0.26,
    );
    const fin = new THREE.Mesh(finGeometry, trimMaterial);
    fin.position.set(0, TARGET_LENGTH * 0.14, TARGET_LENGTH * 0.3);
    group.add(fin);

    // Engine bell. MeshBasicMaterial so it glows regardless of lighting, and it
    // is the first thing Day 4's bloom pass will pick up.
    const engineGeometry = new THREE.CylinderGeometry(
      TARGET_LENGTH * 0.1,
      TARGET_LENGTH * 0.07,
      TARGET_LENGTH * 0.14,
      12,
    );
    engineGeometry.rotateX(Math.PI / 2);
    const engineMaterial = new THREE.MeshBasicMaterial({ color: 0x7fd4ff });
    const engine = new THREE.Mesh(engineGeometry, engineMaterial);
    engine.position.z = TARGET_LENGTH * 0.42;
    group.add(engine);

    this.disposables.push(
      hullMaterial,
      trimMaterial,
      noseGeometry,
      wingGeometry,
      finGeometry,
      engineGeometry,
      engineMaterial,
    );
    this.boundingRadius = TARGET_LENGTH * 0.55;
    return group;
  }

  /**
   * Two child lights on the wingtips. They exist mainly to demonstrate Unit V
   * object hierarchies: they are positioned in the ship's local space and
   * inherit every rotation of the parent for free.
   */
  private buildNavigationLights(): THREE.Object3D {
    const group = new THREE.Group();
    group.name = 'NavLights';
    const geometry = new THREE.SphereGeometry(TARGET_LENGTH * 0.05, 8, 6);
    const port = new THREE.MeshBasicMaterial({ color: 0xff4d4d });
    const starboard = new THREE.MeshBasicMaterial({ color: 0x4dff88 });

    const left = new THREE.Mesh(geometry, port);
    left.position.set(-TARGET_LENGTH * 0.5, 0, TARGET_LENGTH * 0.3);
    const right = new THREE.Mesh(geometry, starboard);
    right.position.set(TARGET_LENGTH * 0.5, 0, TARGET_LENGTH * 0.3);

    group.add(left, right);
    this.disposables.push(geometry, port, starboard);
    return group;
  }

  /**
   * CLAUDE.md: dispose geometries, materials and textures when a scene unloads.
   * Traversal covers the glTF model's own resources as well as the fallback hull.
   */
  dispose(): void {
    this.root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    });
    for (const resource of this.disposables) resource.dispose();
    this.disposables.length = 0;
    this.root.clear();
  }
}
