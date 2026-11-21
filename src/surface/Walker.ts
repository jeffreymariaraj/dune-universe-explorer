// Day 8. Unit V: kinematics, force computation and heightfield collision.
// Unit II: logical input (the same actions as the ship, re-read on foot).
//
// A first-person walker on the generated surface. Per fixed step:
//   1. horizontal velocity eases towards the stick (walk, or run with boost)
//      in the direction the walker faces;
//   2. gravity g = G M / R^2 of THIS planet (from planets.json) pulls it down,
//      integrated with velocity Verlet like the ship;
//   3. heightfield collision: the feet may never go below groundAt(x, z), the
//      same function the terrain mesh was built from. Landing zeroes the fall;
//   4. slopes steeper than maxSlope cannot be walked up: the uphill part of the
//      move is removed, so the walker slides along cliffs instead of climbing.
// Water counts as ground you wade/swim in: the walker floats at the surface,
// slower. Jump uses the 'brake' action (Space).
//
// Pure of rendering: SurfaceScene interpolates prevPosition -> position.

import * as THREE from 'three';
import type { InputManager } from '../core/InputManager';
import { integratePosition, integrateVelocity, smoothingFactor } from '../physics/integrator';

/** Ground height under (x, z), and whether that "ground" is water. */
export interface GroundQuery {
  height(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
}

/** What the walker reads each step: the InputManager in the game, a stub in tests. */
export type WalkerInput = Pick<InputManager, 'getAxis' | 'isDown'>;

export interface WalkerTuning {
  walkSpeed: number;
  runSpeed: number;
  swimSpeed: number;
  /** How quickly horizontal speed follows the stick, 1/s. */
  acceleration: number;
  jumpSpeed: number;
  /** Eye height above the feet. */
  eyeHeight: number;
  /** Steepest walkable ground, as the minimum normal.y (0.6 is about 53 degrees). */
  maxSlope: number;
  turnRate: number;
  lookRate: number;
}

export const DEFAULT_WALKER: WalkerTuning = {
  walkSpeed: 6,
  runSpeed: 14,
  swimSpeed: 3,
  acceleration: 8,
  jumpSpeed: 6,
  eyeHeight: 1.7,
  maxSlope: 0.6,
  turnRate: 1.8,
  lookRate: 1.4,
};

export class Walker {
  readonly tuning: WalkerTuning = { ...DEFAULT_WALKER };
  /** Feet position. */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly prevPosition = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  prevYaw = 0;
  prevPitch = 0;
  grounded = false;
  swimming = false;

  private readonly gravityAcceleration: THREE.Vector3;
  private readonly targetVelocity = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private jumpHeld = false;

  /**
   * @param gravity Surface gravity, world units / s^2 (g = G M / R^2).
   */
  constructor(
    private readonly ground: GroundQuery,
    private readonly input: WalkerInput,
    readonly gravity: number,
  ) {
    this.gravityAcceleration = new THREE.Vector3(0, -gravity, 0);
  }

  /** Stand at (x, z) on the ground, facing `yaw`. */
  placeAt(x: number, z: number, yaw = 0): void {
    this.position.set(x, this.ground.height(x, z), z);
    this.velocity.set(0, 0, 0);
    this.yaw = this.prevYaw = yaw;
    this.pitch = this.prevPitch = 0;
    this.prevPosition.copy(this.position);
    this.grounded = true;
  }

  update(dt: number): void {
    const t = this.tuning;
    this.prevPosition.copy(this.position);
    this.prevYaw = this.yaw;
    this.prevPitch = this.pitch;

    // Look: yaw/pitch axes (keys or pointer-lock mouse).
    this.yaw += this.input.getAxis('yaw') * t.turnRate * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch + this.input.getAxis('pitch') * t.lookRate * dt, -1.3, 1.3);

    // 1. Horizontal intent: forward along the facing (-Z rotated by yaw).
    const forward = this.input.getAxis('thrust');
    const speed = this.swimming ? t.swimSpeed : this.input.isDown('boost') ? t.runSpeed : t.walkSpeed;
    this.targetVelocity.set(-Math.sin(this.yaw) * forward * speed, 0, -Math.cos(this.yaw) * forward * speed);
    const follow = smoothingFactor(this.grounded || this.swimming ? t.acceleration : t.acceleration * 0.15, dt);
    this.velocity.x += (this.targetVelocity.x - this.velocity.x) * follow;
    this.velocity.z += (this.targetVelocity.z - this.velocity.z) * follow;

    // Jump on the press edge only.
    const jump = this.input.isDown('brake');
    if (jump && !this.jumpHeld && (this.grounded || this.swimming)) {
      this.velocity.y = t.jumpSpeed;
      this.grounded = false;
    }
    this.jumpHeld = jump;

    // 4. Slope limit: remove the uphill part of the move on ground too steep to climb.
    if (this.grounded) {
      this.groundNormal(this.position.x, this.position.z, this.normal);
      if (this.normal.y < t.maxSlope) {
        const uphill = -(this.velocity.x * this.normal.x + this.velocity.z * this.normal.z);
        if (uphill > 0) {
          // The normal's horizontal part points downhill; push back along it.
          const horizontal = Math.hypot(this.normal.x, this.normal.z) || 1;
          this.velocity.x += (this.normal.x / horizontal) * (uphill / horizontal);
          this.velocity.z += (this.normal.z / horizontal) * (uphill / horizontal);
        }
      }
    }

    // 2. Gravity, velocity Verlet (constant g, so a(t) = a(t + dt)).
    integratePosition(this.position, this.velocity, this.gravityAcceleration, dt, this.position);
    integrateVelocity(this.velocity, this.gravityAcceleration, this.gravityAcceleration, dt, this.velocity);

    // 3. Heightfield collision: feet never below the ground.
    const groundY = this.ground.height(this.position.x, this.position.z);
    this.swimming = this.ground.isWater(this.position.x, this.position.z);
    if (this.position.y <= groundY) {
      this.position.y = groundY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    } else {
      // Walking down a gentle slope should stick to it, not hop: snap if close.
      const snap = this.grounded && this.velocity.y <= 0 && this.position.y - groundY < 0.35;
      if (snap) this.position.y = groundY;
      else this.grounded = false;
    }
  }

  /** Ground normal at (x, z) by central differences of the heightfield. */
  groundNormal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = 0.5;
    const dx = (this.ground.height(x + e, z) - this.ground.height(x - e, z)) / (2 * e);
    const dz = (this.ground.height(x, z + e) - this.ground.height(x, z - e)) / (2 * e);
    return out.set(-dx, 1, -dz).normalize();
  }

  /** Eye position for the camera, interpolated between steps. */
  eye(alpha: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.lerpVectors(this.prevPosition, this.position, alpha).setY(
      THREE.MathUtils.lerp(this.prevPosition.y, this.position.y, alpha) + this.tuning.eyeHeight,
    );
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
}
