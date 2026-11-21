// Day 4. Unit V: particle systems. Unit I: point primitives and blending.
//
// GPU-driven THREE.Points trail behind the thrusters. A fixed-size ring buffer:
// emitting a particle overwrites the oldest slot with its start position,
// velocity, birth time and lifetime, and trail.vert.glsl does the rest
// (position = start + velocity * age, plus size and colour over life). The CPU
// never touches a particle again after it is born.
//
// Particles live in WORLD space (not parented to the ship), so they stay where
// they were emitted and draw a trail as the ship flies on. Emission runs on the
// fixed step; the shader's clock is the same simulation clock.

import * as THREE from 'three';
import { createRandom } from '../physics/noise';
import trailVertex from '../shaders/trail.vert.glsl';
import trailFragment from '../shaders/trail.frag.glsl';

export interface TrailTuning {
  /** Particles per second at full throttle (boost doubles it). */
  rate: number;
  /** Exhaust speed out of the nozzle, world units / s. */
  exhaustSpeed: number;
  /** Fraction of the ship's velocity the exhaust keeps (0 = hangs in space). */
  inheritVelocity: number;
  /** Lifetime range, seconds. */
  minLife: number;
  maxLife: number;
  /** Puff size at birth, world units. */
  size: number;
}

export const DEFAULT_TRAIL: TrailTuning = {
  rate: 140,
  exhaustSpeed: 22,
  inheritVelocity: 0.15,
  minLife: 0.5,
  maxLife: 1.1,
  size: 1.0,
};

export class EngineTrail {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly tuning: TrailTuning = { ...DEFAULT_TRAIL };

  private readonly capacity: number;
  private next = 0;
  /** Fractional particles carried between steps, so low rates still emit. */
  private debt = 0;
  private readonly starts: THREE.BufferAttribute;
  private readonly velocities: THREE.BufferAttribute;
  private readonly births: THREE.BufferAttribute;
  private readonly lives: THREE.BufferAttribute;
  private readonly sizes: THREE.BufferAttribute;
  private random = createRandom(4242);
  private readonly scratch = new THREE.Vector3();

  constructor(capacity = 1500) {
    this.capacity = capacity;
    const geometry = new THREE.BufferGeometry();
    this.starts = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.velocities = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    // Born "long ago": every slot starts dead.
    this.births = new THREE.BufferAttribute(new Float32Array(capacity).fill(-1e6), 1);
    this.lives = new THREE.BufferAttribute(new Float32Array(capacity).fill(1), 1);
    this.sizes = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    for (const attribute of [this.starts, this.velocities, this.births, this.lives, this.sizes]) {
      attribute.setUsage(THREE.DynamicDrawUsage);
    }
    geometry.setAttribute('position', this.starts);
    geometry.setAttribute('aVelocity', this.velocities);
    geometry.setAttribute('aBirth', this.births);
    geometry.setAttribute('aLife', this.lives);
    geometry.setAttribute('aSize', this.sizes);

    const material = new THREE.ShaderMaterial({
      vertexShader: trailVertex,
      fragmentShader: trailFragment,
      uniforms: {
        uTime: { value: 0 },
        uViewportHeight: { value: 1080 },
        uHotColor: { value: new THREE.Color('#bfe8ff').multiplyScalar(1.3) },
        uCoolColor: { value: new THREE.Color('#ff7a2e') },
      },
      transparent: true,
      depthWrite: false, // puffs never hide each other or the stars
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.name = 'EngineTrail';
    // The shader moves the particles, so the geometry's bounds are meaningless.
    this.points.frustumCulled = false;
  }

  /**
   * Fixed step: emit particles for this step from the nozzle.
   * @param throttle 0..1 forward thrust; boost doubles the rate.
   * @param time     Simulation clock (same one passed to setTime).
   */
  emit(
    nozzle: THREE.Vector3,
    backward: THREE.Vector3,
    shipVelocity: THREE.Vector3,
    throttle: number,
    boosting: boolean,
    time: number,
    dt: number,
  ): void {
    const t = this.tuning;
    if (throttle <= 0) {
      this.debt = 0;
      return;
    }
    this.debt += t.rate * throttle * (boosting ? 2 : 1) * dt;
    const count = Math.floor(this.debt);
    this.debt -= count;
    if (count === 0) return;

    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      const r = this.random;

      // Spread births across the step so a fast ship leaves a line, not clumps.
      const fraction = (n + r()) / count;
      this.scratch.copy(nozzle).addScaledVector(shipVelocity, -dt * (1 - fraction));
      this.starts.setXYZ(i, this.scratch.x, this.scratch.y, this.scratch.z);

      const speed = t.exhaustSpeed * (boosting ? 1.6 : 1) * (0.8 + r() * 0.4);
      this.scratch
        .copy(backward)
        .multiplyScalar(speed)
        .addScaledVector(shipVelocity, t.inheritVelocity)
        .add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(4));
      this.velocities.setXYZ(i, this.scratch.x, this.scratch.y, this.scratch.z);

      this.births.setX(i, time - dt * (1 - fraction));
      this.lives.setX(i, t.minLife + r() * (t.maxLife - t.minLife));
      this.sizes.setX(i, t.size * (boosting ? 1.4 : 1) * (0.7 + r() * 0.6));
    }
    for (const attribute of [this.starts, this.velocities, this.births, this.lives, this.sizes]) {
      attribute.needsUpdate = true;
    }
  }

  /** Render frame: the shader's clock and the viewport height for sizing. */
  setTime(time: number): void {
    this.points.material.uniforms['uTime']!.value = time;
  }

  setViewportHeight(pixels: number): void {
    this.points.material.uniforms['uViewportHeight']!.value = pixels;
  }

  /** Kill every particle (teleports, respawn). */
  reset(): void {
    (this.births.array as Float32Array).fill(-1e6);
    this.births.needsUpdate = true;
    this.debt = 0;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
