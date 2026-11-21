// Unit IV: 3D transforms with quaternions. Unit V: force computation and kinematics.
//
// 6-DOF Newtonian flight. Translation has 3 degrees of freedom (thrust along the
// hull axis today; strafing can be added later) and rotation has 3 (yaw, pitch,
// roll), all held as a quaternion so there are no gimbal-lock singularities and
// no Euler-order ambiguity.
//
// Control model: input sets a TARGET angular velocity rather than a torque. That
// gives a responsive, predictable stick feel while still integrating properly —
// the rate is eased towards the target, then composed into the orientation by
// integrateOrientation().
//
// Day 5: gravity. The ship's acceleration is thrust (constant over a step,
// along the hull) plus gravity (depends on WHERE the ship is). Velocity Verlet
// needs the acceleration at both ends of the step, so gravity is evaluated at
// the start position (bodies where they were) and again at the end position
// (bodies where they are now). The field itself is injected by the space scene,
// so the controller knows nothing about planets.
//
// Runs only on the fixed step. Never call from a render callback.

import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { InputManager } from '../core/InputManager';
import {
  applyDamping,
  clampLength,
  integrateOrientation,
  integratePosition,
  integrateVelocity,
  smoothingFactor,
} from '../physics/integrator';

/**
 * Gravity on the ship. `when` is 'start' (bodies as they were at the start of
 * this step) or 'end' (as they are now). Writes the acceleration into `out`.
 */
export type ShipGravity = (position: THREE.Vector3, when: 'start' | 'end', out: THREE.Vector3) => THREE.Vector3;
import { SHIP_FORWARD, type Ship } from './Ship';

export interface FlightTuning {
  /** Main engine acceleration, world units / s^2. */
  thrust: number;
  /** Multiplier applied while `boost` is held. */
  boostMultiplier: number;
  /** Reverse thrust as a fraction of `thrust`. */
  reverseFraction: number;
  /** Extra damping applied while `brake` is held, 1/s. */
  brakeDamping: number;
  /** Always-on drag. Space has none, but a little makes the ship flyable. */
  idleDamping: number;
  /** Speed ceiling, world units / s. */
  maxSpeed: number;
  /** Peak rotation rates, rad/s. */
  yawRate: number;
  pitchRate: number;
  rollRate: number;
  /** How quickly the actual rotation rate reaches the commanded one, 1/s. */
  rotationResponse: number;
  /** Rotation decay once the stick is released, 1/s. */
  rotationDamping: number;
}

export const DEFAULT_TUNING: FlightTuning = {
  thrust: 48,
  boostMultiplier: 3.5,
  reverseFraction: 0.5,
  brakeDamping: 2.2,
  idleDamping: 0.12,
  maxSpeed: 600,
  yawRate: 0.9,
  pitchRate: 1.0,
  rollRate: 1.6,
  rotationResponse: 7,
  rotationDamping: 3.2,
};

/** Telemetry is published at 20 Hz, not 120 Hz: the HUD cannot use more. */
const TELEMETRY_EVERY_N_STEPS = 6;

export class ShipController {
  readonly tuning: FlightTuning = { ...DEFAULT_TUNING };

  /** Set by the space scene; null means no gravity (e.g. on the surface). */
  gravity: ShipGravity | null = null;

  /** a(t) and a(t + dt) for this step's velocity-Verlet update. */
  private readonly previousAcceleration = new THREE.Vector3();
  private readonly acceleration = new THREE.Vector3();
  private readonly thrustAcceleration = new THREE.Vector3();
  private readonly gravityAcceleration = new THREE.Vector3();
  private readonly targetAngularVelocity = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private stepCounter = 0;
  private boosting = false;
  private forwardThrottle = 0;

  constructor(
    private readonly ship: Ship,
    private readonly input: InputManager,
    private readonly bus: EventBus,
  ) {}

  /** Gravity felt at the end of the last step, world units / s^2 (HUD, debug). */
  get gravityMagnitude(): number {
    return this.gravityAcceleration.length();
  }

  get isBoosting(): boolean {
    return this.boosting;
  }

  /** Forward thrust this step, 0..1 (reverse thrust does not light the main engine). */
  get throttle(): number {
    return this.forwardThrottle;
  }

  update(dt: number): void {
    this.updateRotation(dt);
    this.updateTranslation(dt);

    if (++this.stepCounter >= TELEMETRY_EVERY_N_STEPS) {
      this.stepCounter = 0;
      this.publishTelemetry();
    }
  }

  // Unit IV: rotation about the body axes, composed as quaternions.
  private updateRotation(dt: number): void {
    const { tuning } = this;
    const yaw = this.input.getAxis('yaw');
    const pitch = this.input.getAxis('pitch');
    const roll = this.input.getAxis('roll');

    // Body-frame axes: X = right (pitch), Y = up (yaw), Z = back (roll).
    // Pitch "nose up" is a negative rotation about local X because forward is -Z.
    this.targetAngularVelocity.set(
      -pitch * tuning.pitchRate,
      yaw * tuning.yawRate,
      roll * tuning.rollRate,
    );

    const commanded = this.targetAngularVelocity.lengthSq() > 1e-8;
    const lambda = commanded ? tuning.rotationResponse : tuning.rotationDamping;
    const factor = smoothingFactor(lambda, dt);

    this.ship.angularVelocity.lerp(this.targetAngularVelocity, factor);
    if (!commanded) applyDamping(this.ship.angularVelocity, tuning.rotationDamping, dt);

    integrateOrientation(
      this.ship.orientation,
      this.ship.angularVelocity,
      dt,
      this.ship.orientation,
    );
  }

  // Unit V: force computation, then velocity Verlet integration.
  private updateTranslation(dt: number): void {
    const { tuning } = this;
    const thrustAxis = this.input.getAxis('thrust');
    this.boosting = this.input.isDown('boost');
    this.forwardThrottle = Math.max(0, thrustAxis);
    const braking = this.input.isDown('brake');

    // Thrust acts along the hull axis, so it rotates with the ship.
    this.thrustAcceleration.set(0, 0, 0);
    if (thrustAxis !== 0) {
      const magnitude =
        thrustAxis > 0
          ? thrustAxis * tuning.thrust * (this.boosting ? tuning.boostMultiplier : 1)
          : thrustAxis * tuning.thrust * tuning.reverseFraction;
      this.scratch.copy(SHIP_FORWARD).applyQuaternion(this.ship.orientation);
      this.thrustAcceleration.addScaledVector(this.scratch, magnitude);
    }

    // a(t) = thrust + gravity at the start position.
    this.previousAcceleration.copy(this.thrustAcceleration);
    if (this.gravity) {
      this.previousAcceleration.add(this.gravity(this.ship.position, 'start', this.gravityAcceleration));
    }

    integratePosition(
      this.ship.position,
      this.ship.velocity,
      this.previousAcceleration,
      dt,
      this.ship.position,
    );

    // a(t + dt) = thrust + gravity at the NEW position.
    this.acceleration.copy(this.thrustAcceleration);
    if (this.gravity) {
      this.acceleration.add(this.gravity(this.ship.position, 'end', this.gravityAcceleration));
    }

    integrateVelocity(
      this.ship.velocity,
      this.previousAcceleration,
      this.acceleration,
      dt,
      this.ship.velocity,
    );

    applyDamping(this.ship.velocity, braking ? tuning.brakeDamping : tuning.idleDamping, dt);
    clampLength(this.ship.velocity, tuning.maxSpeed);
  }

  private publishTelemetry(): void {
    const { x, y, z } = this.ship.position;
    this.bus.emit('ship:telemetry', {
      speed: this.ship.speed,
      position: { x, y, z },
      boosting: this.boosting,
      hull: this.ship.hull,
      throttle: this.forwardThrottle,
    });
  }

  /** Put the ship back at the origin, at rest and level. */
  reset(): void {
    this.ship.position.set(0, 0, 0);
    this.ship.velocity.set(0, 0, 0);
    this.ship.angularVelocity.set(0, 0, 0);
    this.ship.orientation.identity();
    this.acceleration.set(0, 0, 0);
    this.previousAcceleration.set(0, 0, 0);
    this.ship.syncRenderTransform();
  }
}
