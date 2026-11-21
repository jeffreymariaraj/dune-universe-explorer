// Unit V: physical modelling — force computation, integration and smoothing.
//
// Small pure functions, deliberately free of any scene or engine state, so they
// can be unit tested (integrator.test.ts) and reasoned about in the viva.
// Every function takes an explicit dt: the engine always passes 1/120 s.

import * as THREE from 'three';

/**
 * Velocity Verlet, position half-step.
 *
 *   x(t + dt) = x(t) + v(t) dt + 1/2 a(t) dt^2
 *
 * This is second-order accurate, so a ship under constant thrust lands exactly
 * where the closed-form kinematic equation says it should — unlike plain Euler,
 * which loses 1/2 a dt^2 every step.
 */
export function integratePosition(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  acceleration: THREE.Vector3,
  dt: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  return out
    .copy(position)
    .addScaledVector(velocity, dt)
    .addScaledVector(acceleration, 0.5 * dt * dt);
}

/**
 * Velocity Verlet, velocity half-step.
 *
 *   v(t + dt) = v(t) + 1/2 (a(t) + a(t + dt)) dt
 *
 * Averaging the old and new acceleration is what makes the scheme symplectic,
 * which is why planet-and-ship orbits do not spiral in over a long demo.
 */
export function integrateVelocity(
  velocity: THREE.Vector3,
  accelerationOld: THREE.Vector3,
  accelerationNew: THREE.Vector3,
  dt: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  return out
    .copy(velocity)
    .addScaledVector(accelerationOld, 0.5 * dt)
    .addScaledVector(accelerationNew, 0.5 * dt);
}

/**
 * Exponential (viscous) damping: dv/dt = -k v, solved exactly as v *= e^(-k dt).
 * Using the closed form instead of (1 - k dt) keeps the behaviour identical at
 * any timestep and can never overshoot into negative velocity.
 */
export function applyDamping(velocity: THREE.Vector3, k: number, dt: number): THREE.Vector3 {
  if (k <= 0) return velocity;
  return velocity.multiplyScalar(Math.exp(-k * dt));
}

/**
 * Frame-rate-independent smoothing factor for an exponential follow
 * (`current += (target - current) * factor`).
 *
 * A raw lerp factor is wrong whenever dt changes: 0.1 per step means something
 * different at 30 and 144 fps. 1 - e^(-lambda dt) is the exact solution of
 * dx/dt = lambda (target - x), so the camera lags by the same amount in seconds
 * no matter the frame rate. `lambda` is "how many e-foldings per second".
 */
export function smoothingFactor(lambda: number, dt: number): number {
  if (lambda <= 0) return 0;
  return 1 - Math.exp(-lambda * dt);
}

/** Clamp a vector's magnitude without touching its direction. */
export function clampLength(vector: THREE.Vector3, maxLength: number): THREE.Vector3 {
  const lengthSquared = vector.lengthSq();
  if (lengthSquared > maxLength * maxLength && lengthSquared > 0) {
    vector.multiplyScalar(maxLength / Math.sqrt(lengthSquared));
  }
  return vector;
}

/**
 * Integrate an angular velocity (rad/s, in the body frame) into an orientation.
 *
 *   q(t + dt) = q(t) * dq,  where dq is the rotation of |omega| dt about omega
 *
 * Composing an exact axis-angle delta (rather than the usual first-order
 * quaternion derivative) means no drift and no need to renormalise every step,
 * though we renormalise anyway because float error accumulates over minutes.
 */
export function integrateOrientation(
  orientation: THREE.Quaternion,
  angularVelocity: THREE.Vector3,
  dt: number,
  out = new THREE.Quaternion(),
): THREE.Quaternion {
  const speed = angularVelocity.length();
  out.copy(orientation);
  if (speed > 1e-9) {
    const axis = angularVelocity.clone().divideScalar(speed);
    const delta = new THREE.Quaternion().setFromAxisAngle(axis, speed * dt);
    out.multiply(delta); // body-frame rotation: post-multiply
  }
  return out.normalize();
}

/** Acceleration field: writes a(position) into `out` and returns it. */
export type AccelerationField = (position: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3;

/**
 * One full velocity-Verlet step for a position-dependent force (gravity):
 *
 *   x(t+dt) = x + v dt + 1/2 a(t) dt^2
 *   a(t+dt) = field(x(t+dt))                <- evaluated at the NEW position
 *   v(t+dt) = v + 1/2 (a(t) + a(t+dt)) dt
 *
 * `acceleration` holds a(t) on entry and a(t+dt) on exit, so a caller stepping
 * repeatedly evaluates the field only once per step. Symplectic: orbit energy
 * oscillates slightly but does not drift, unlike explicit Euler, which spirals
 * outward (see integrator.test.ts).
 */
export function verletStep(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  acceleration: THREE.Vector3,
  field: AccelerationField,
  dt: number,
): void {
  const oldAx = acceleration.x;
  const oldAy = acceleration.y;
  const oldAz = acceleration.z;
  integratePosition(position, velocity, acceleration, dt, position);
  field(position, acceleration);
  velocity.x += 0.5 * (oldAx + acceleration.x) * dt;
  velocity.y += 0.5 * (oldAy + acceleration.y) * dt;
  velocity.z += 0.5 * (oldAz + acceleration.z) * dt;
}
