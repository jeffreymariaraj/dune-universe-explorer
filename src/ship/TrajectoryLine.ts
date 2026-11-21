// Day 5. Unit III: line primitives (a polyline of up to 601 vertices).
// Unit V: the physically simulated trajectory, drawn.
//
// Holds the points that physics/trajectory.ts predicts and draws them as one
// THREE.Line, fading from bright at the ship to nothing at the far end
// (per-vertex colours, additive blending). Turns red when the path ends in a
// body, so the player can see a collision coming.

import * as THREE from 'three';

export class TrajectoryLine {
  readonly line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  /** Raw predicted points; physics writes here, then commit() uploads them. */
  readonly points: Float32Array;
  readonly capacity: number;

  private readonly colors: Float32Array;
  private readonly safe = new THREE.Color('#7fd4ff');
  private readonly danger = new THREE.Color('#ff5a3c');
  private readonly scratch = new THREE.Color();

  constructor(steps: number) {
    this.capacity = steps + 1;
    this.points = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.points, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.line = new THREE.Line(geometry, material);
    this.line.name = 'PredictedTrajectory';
    this.line.frustumCulled = false; // rewritten constantly; bounds would be stale
  }

  /** Upload `count` points from `points`, coloured by whether the path ends in a hit. */
  commit(count: number, endsInImpact: boolean): void {
    const base = endsInImpact ? this.danger : this.safe;
    for (let i = 0; i < count; i++) {
      // Fade to black along the line; additive blending turns black into "invisible".
      const fade = 1 - i / Math.max(count - 1, 1);
      this.scratch.copy(base).multiplyScalar(0.15 + 0.85 * fade * fade);
      this.colors[i * 3 + 0] = this.scratch.r;
      this.colors[i * 3 + 1] = this.scratch.g;
      this.colors[i * 3 + 2] = this.scratch.b;
    }
    const geometry = this.line.geometry;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('color').needsUpdate = true;
    geometry.setDrawRange(0, count);
  }

  set visible(value: boolean) {
    this.line.visible = value;
  }

  get visible(): boolean {
    return this.line.visible;
  }

  clear(): void {
    this.line.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.line.removeFromParent();
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}
