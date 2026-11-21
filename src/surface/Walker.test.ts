import { describe, expect, it } from 'vitest';
import type { AxisAction, ButtonAction } from '../core/InputManager';
import { Walker, type GroundQuery, type WalkerInput } from './Walker';

const DT = 1 / 120;

function stubInput(axes: Partial<Record<AxisAction, number>> = {}, buttons: Partial<Record<ButtonAction, boolean>> = {}): WalkerInput {
  return {
    getAxis: (action) => axes[action] ?? 0,
    isDown: (action) => buttons[action] ?? false,
  };
}

const flat: GroundQuery = { height: () => 0, isWater: () => false };

describe('Walker', () => {
  it('falls under planet gravity and stops on the ground', () => {
    const walker = new Walker(flat, stubInput(), 5.4);
    walker.placeAt(0, 0);
    walker.position.y = 10;
    walker.grounded = false;
    // Free fall time from 10 u at g = 5.4: sqrt(2 h / g) = 1.92 s.
    let steps = 0;
    while (!walker.grounded && steps < 1000) {
      walker.update(DT);
      steps++;
    }
    expect(steps * DT).toBeCloseTo(Math.sqrt((2 * 10) / 5.4), 1);
    expect(walker.position.y).toBe(0);
    expect(walker.velocity.y).toBe(0);
  });

  it('jumps to v^2 / 2g and lands again', () => {
    const input = { jump: true };
    const walker = new Walker(flat, { getAxis: () => 0, isDown: (a) => a === 'brake' && input.jump }, 5.4);
    walker.placeAt(0, 0);
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      walker.update(DT);
      input.jump = false;
      peak = Math.max(peak, walker.position.y);
    }
    expect(peak).toBeCloseTo((6 * 6) / (2 * 5.4), 1);
    expect(walker.grounded).toBe(true);
  });

  it('walks forward at walking speed and runs faster with boost', () => {
    const walk = new Walker(flat, stubInput({ thrust: 1 }), 5.4);
    walk.placeAt(0, 0);
    for (let i = 0; i < 240; i++) walk.update(DT);
    expect(walk.speed).toBeCloseTo(walk.tuning.walkSpeed, 1);
    expect(walk.position.z).toBeLessThan(0); // facing -Z

    const run = new Walker(flat, stubInput({ thrust: 1 }, { boost: true }), 5.4);
    run.placeAt(0, 0);
    for (let i = 0; i < 240; i++) run.update(DT);
    expect(run.speed).toBeCloseTo(run.tuning.runSpeed, 1);
  });

  it('follows the heightfield: never below the ground on a slope', () => {
    const ramp: GroundQuery = { height: (_x, z) => -z * 0.3, isWater: () => false }; // rises to the north
    const walker = new Walker(ramp, stubInput({ thrust: 1 }), 5.4);
    walker.placeAt(0, 0);
    for (let i = 0; i < 600; i++) {
      walker.update(DT);
      expect(walker.position.y).toBeGreaterThanOrEqual(ramp.height(walker.position.x, walker.position.z) - 1e-9);
    }
    expect(walker.position.z).toBeLessThan(-10); // climbed a gentle slope
  });

  it('cannot walk up a cliff steeper than maxSlope', () => {
    const cliff: GroundQuery = { height: (_x, z) => -z * 3, isWater: () => false }; // normal.y ~ 0.32
    const walker = new Walker(cliff, stubInput({ thrust: 1 }), 5.4);
    walker.placeAt(0, 0);
    for (let i = 0; i < 600; i++) walker.update(DT);
    expect(walker.position.z).toBeGreaterThan(-1);
  });

  it('swims slowly in water', () => {
    const sea: GroundQuery = { height: () => 0, isWater: () => true };
    const walker = new Walker(sea, stubInput({ thrust: 1 }), 5.4);
    walker.placeAt(0, 0);
    for (let i = 0; i < 240; i++) walker.update(DT);
    expect(walker.swimming).toBe(true);
    expect(walker.speed).toBeCloseTo(walker.tuning.swimSpeed, 1);
  });
});
