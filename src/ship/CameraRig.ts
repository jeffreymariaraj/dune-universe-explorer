// Unit IV: the viewing pipeline, view volume and projections.
// Unit V: smoothing / damped follow.
//
// A chase camera that trails the ship with critically-damped exponential
// smoothing. Two things matter here:
//
//   * The lag is expressed in 1/s (how many e-foldings per second), not as a
//     per-frame lerp constant, so the feel is identical at 30 or 144 fps. See
//     smoothingFactor() in physics/integrator.ts.
//   * Like the ship, the rig advances on the fixed step and stores its previous
//     pose, so render() can interpolate instead of simulating.
//
// `mode` is wired for the cockpit and orbit cameras that Day 10 needs; only
// chase is implemented today.
//
// Day 4: camera shake on impact, using the "trauma" model. An impact adds
// trauma (0..1), trauma decays linearly, and the shake amplitude is trauma^2 so
// small knocks are subtle and big hits are violent. The offset comes from
// smooth simplex noise rather than random numbers, so it shudders instead of
// jittering. Shake is added on top of the smoothed pose, never fed back into it.

import * as THREE from 'three';
import { smoothingFactor } from '../physics/integrator';
import { snoise3 } from '../physics/noise';
import type { Ship } from './Ship';

export type CameraMode = 'chase' | 'cockpit' | 'orbit';

export interface CameraTuning {
  /** Position follow rate, 1/s. Lower lags further behind. */
  damping: number;
  /** Aim follow rate, 1/s. Usually a little stiffer than position. */
  rotationDamping: number;
  /** Camera seat in the ship's local frame (+Z is behind, forward is -Z). */
  offset: THREE.Vector3;
  /** How far ahead of the ship the camera aims, in world units. */
  lookAhead: number;
  /** Vertical field of view in degrees (Unit IV: view volume). */
  fov: number;
  /** Extra degrees of FOV at max speed, for a sense of velocity. */
  fovBoost: number;
  /** Peak shake offset at full trauma, world units. */
  shakeOffset: number;
  /** Peak shake roll at full trauma, radians. */
  shakeRoll: number;
  /** Trauma lost per second. */
  traumaDecay: number;
  /** Speed at which fovBoost is fully applied. */
  fovBoostSpeed: number;
}

export const DEFAULT_CAMERA_TUNING: CameraTuning = {
  damping: 6,
  rotationDamping: 9,
  offset: new THREE.Vector3(0, 4.4, 15),
  lookAhead: 28,
  fov: 62,
  fovBoost: 10,
  fovBoostSpeed: 320,
  shakeOffset: 1.4,
  shakeRoll: 0.06,
  traumaDecay: 1.3,
};

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly tuning: CameraTuning;
  mode: CameraMode = 'chase';

  // --- simulation pose (fixed step) ---
  private readonly position = new THREE.Vector3();
  private readonly orientation = new THREE.Quaternion();
  // --- previous pose, for render interpolation ---
  private readonly prevPosition = new THREE.Vector3();
  private readonly prevOrientation = new THREE.Quaternion();

  private currentFov: number;

  // --- camera shake (Day 4) ---
  private trauma = 0;
  private shakeTime = 0;
  private readonly shake = new THREE.Vector3();
  private readonly prevShake = new THREE.Vector3();
  private shakeRollAngle = 0;
  private prevShakeRollAngle = 0;
  private readonly shakeScratch = new THREE.Vector3();
  private readonly rollQuaternion = new THREE.Quaternion();

  // Scratch objects, reused so the fixed step allocates nothing.
  private readonly desiredPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly shipUp = new THREE.Vector3();
  private readonly shipForward = new THREE.Vector3();
  private readonly lookMatrix = new THREE.Matrix4();
  private readonly desiredOrientation = new THREE.Quaternion();

  constructor(
    private readonly ship: Ship,
    aspect: number,
    tuning: Partial<CameraTuning> = {},
  ) {
    this.tuning = { ...DEFAULT_CAMERA_TUNING, ...tuning, offset: (tuning.offset ?? DEFAULT_CAMERA_TUNING.offset).clone() };
    this.currentFov = this.tuning.fov;

    // Unit IV: near and far define the view volume; everything outside is clipped.
    this.camera = new THREE.PerspectiveCamera(this.tuning.fov, aspect, 0.5, 60_000);
    this.camera.name = 'ChaseCamera';
    this.snapToShip();
  }

  /** Fixed step: move the rig towards where it wants to be. */
  update(dt: number): void {
    this.prevPosition.copy(this.position);
    this.prevOrientation.copy(this.orientation);

    this.computeDesiredPose();

    const positionFactor = smoothingFactor(this.tuning.damping, dt);
    const rotationFactor = smoothingFactor(this.tuning.rotationDamping, dt);
    this.position.lerp(this.desiredPosition, positionFactor);
    this.orientation.slerp(this.desiredOrientation, rotationFactor);

    // Widen the view volume slightly with speed.
    const speedRatio = Math.min(this.ship.speed / this.tuning.fovBoostSpeed, 1);
    const targetFov = this.tuning.fov + this.tuning.fovBoost * speedRatio;
    this.currentFov += (targetFov - this.currentFov) * smoothingFactor(2.5, dt);

    this.updateShake(dt);
  }

  /** Add trauma from an impact (0..1, clamped). */
  addTrauma(amount: number): void {
    this.trauma = THREE.MathUtils.clamp(this.trauma + amount, 0, 1);
  }

  get currentTrauma(): number {
    return this.trauma;
  }

  private updateShake(dt: number): void {
    this.prevShake.copy(this.shake);
    this.prevShakeRollAngle = this.shakeRollAngle;
    this.trauma = Math.max(0, this.trauma - this.tuning.traumaDecay * dt);
    this.shakeTime += dt;

    const amount = this.trauma * this.trauma;
    if (amount <= 0) {
      this.shake.set(0, 0, 0);
      this.shakeRollAngle = 0;
      return;
    }
    // Three decorrelated noise channels, sampled 18 times a second.
    const t = this.shakeTime * 18;
    this.shake.set(snoise3(t, 0, 0), snoise3(0, t, 3.7), snoise3(5.1, 0, t)).multiplyScalar(amount * this.tuning.shakeOffset);
    this.shakeRollAngle = snoise3(t, 9.2, 1.3) * amount * this.tuning.shakeRoll;
  }

  /** Render frame: blend the two most recent poses and push them to the camera. */
  applyInterpolated(alpha: number): void {
    this.camera.position.lerpVectors(this.prevPosition, this.position, alpha);
    this.camera.quaternion.slerpQuaternions(this.prevOrientation, this.orientation, alpha);

    // Shake: an offset in the camera's own frame plus a little roll.
    this.shakeScratch.lerpVectors(this.prevShake, this.shake, alpha).applyQuaternion(this.camera.quaternion);
    this.camera.position.add(this.shakeScratch);
    const roll = this.prevShakeRollAngle + (this.shakeRollAngle - this.prevShakeRollAngle) * alpha;
    if (roll !== 0) {
      this.rollQuaternion.setFromAxisAngle(ROLL_AXIS, roll);
      this.camera.quaternion.multiply(this.rollQuaternion);
    }
    if (Math.abs(this.camera.fov - this.currentFov) > 1e-3) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Jump the camera straight to its ideal pose (scene load, warp arrival). */
  snapToShip(): void {
    this.computeDesiredPose();
    this.position.copy(this.desiredPosition);
    this.orientation.copy(this.desiredOrientation);
    this.prevPosition.copy(this.position);
    this.prevOrientation.copy(this.orientation);
    this.trauma = 0;
    this.shake.set(0, 0, 0);
    this.prevShake.set(0, 0, 0);
    this.shakeRollAngle = 0;
    this.prevShakeRollAngle = 0;
    this.camera.position.copy(this.position);
    this.camera.quaternion.copy(this.orientation);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Where the camera would sit with zero lag: the seat offset rotated into world
   * space, aiming at a point ahead of the ship so turns lead rather than follow.
   */
  private computeDesiredPose(): void {
    const localOffset = this.mode === 'cockpit' ? ZERO_OFFSET : this.tuning.offset;
    this.desiredPosition
      .copy(localOffset)
      .applyQuaternion(this.ship.orientation)
      .add(this.ship.position);

    this.ship.getForward(this.shipForward);
    this.ship.getUp(this.shipUp);
    this.lookTarget.copy(this.ship.position).addScaledVector(this.shipForward, this.tuning.lookAhead);

    // Matrix4.lookAt builds the rotation that points -Z at the target, using the
    // ship's own up vector so the camera rolls with the hull.
    this.lookMatrix.lookAt(this.desiredPosition, this.lookTarget, this.shipUp);
    this.desiredOrientation.setFromRotationMatrix(this.lookMatrix);
  }
}

const ZERO_OFFSET = new THREE.Vector3(0, 0, 0);
/** Camera-local view axis (three.js cameras look down -Z). */
const ROLL_AXIS = new THREE.Vector3(0, 0, 1);
