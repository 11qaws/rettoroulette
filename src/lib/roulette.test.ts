import { describe, expect, it } from 'vitest';

import {
  AUTO_POINTER_ANGLE,
  DART_IMPACT_ANGLE,
  DART_FLIGHT_DURATION_SECONDS,
  buildRouletteFinishPlan,
  calculateDartPostImpactDuration,
  getRouletteSliceGeometry,
  nextWheelRotation,
  normalizeRouletteWeights,
  targetWheelRotation,
} from './roulette';

describe('targetWheelRotation', () => {
  it('aligns the first slice with the usual top pointer', () => {
    expect(targetWheelRotation(0, 4, AUTO_POINTER_ANGLE)).toBe(315);
  });

  it('aligns the same slice with the fixed dart point instead', () => {
    expect(DART_IMPACT_ANGLE).toBe(AUTO_POINTER_ANGLE);
    expect(targetWheelRotation(0, 4, DART_IMPACT_ANGLE)).toBe(315);
  });

  it('adds full visual turns without changing the final target angle', () => {
    const rotation = nextWheelRotation(711, 2, 6, 6, DART_IMPACT_ANGLE);
    expect(((rotation % 360) + 360) % 360).toBe(targetWheelRotation(2, 6, DART_IMPACT_ANGLE));
    expect(rotation).toBeGreaterThan(711 + 5 * 360);
  });

  it('uses the positive draw weights as proportional wedge geometry', () => {
    expect(normalizeRouletteWeights(3, [1, 2, 1])).toEqual([0.25, 0.5, 0.25]);

    const slices = getRouletteSliceGeometry(3, [1, 2, 1]);
    expect(slices.map((slice) => slice.startAngle)).toEqual([-90, 0, 180]);
    expect(slices.map((slice) => slice.endAngle)).toEqual([0, 180, 270]);
    expect(slices.map((slice) => slice.centreAngle)).toEqual([-45, 90, 225]);
  });

  it('aligns a weighted winner centre with both fixed presentation points', () => {
    const weights = [1, 2, 1];

    expect(targetWheelRotation(1, 3, AUTO_POINTER_ANGLE, weights)).toBe(180);
    expect(targetWheelRotation(1, 3, DART_IMPACT_ANGLE, weights)).toBe(180);

    const rotation = nextWheelRotation(289, 1, 3, 6, DART_IMPACT_ANGLE, weights);
    expect(((rotation % 360) + 360) % 360).toBe(180);
  });

  it('falls back to equal wedges when supplied weights have no positive value', () => {
    expect(normalizeRouletteWeights(4, [0, -3, Number.NaN, 0])).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
});

const normalized = (angle: number) => ((angle % 360) + 360) % 360;
const localAngleAtPointer = (rotation: number) => normalized(AUTO_POINTER_ANGLE - rotation);

describe('buildRouletteFinishPlan', () => {
  it('crosses the winning boundary clockwise before landing inside the winner', () => {
    const plan = buildRouletteFinishPlan(11, 0, 4, 2, undefined, {
      entryGapDegrees: 12,
      leadDegrees: 20,
    });

    expect(plan.focusRotation).toBeLessThan(plan.boundaryRotation);
    expect(plan.boundaryRotation).toBeLessThan(plan.finalRotation);
    expect(plan.focusRotation).toBeGreaterThanOrEqual(11 + 2 * 360);
    expect(localAngleAtPointer(plan.focusRotation)).toBe(12);
    expect(localAngleAtPointer(plan.boundaryRotation)).toBe(0);
    expect(localAngleAtPointer(plan.finalRotation)).toBe(340);
  });

  it('uses weighted wedge boundaries and remains monotonic', () => {
    const weights = [1, 2, 1];
    const plan = buildRouletteFinishPlan(289, 1, 3, 5, weights, {
      entryGapDegrees: 15,
      leadDegrees: 35,
    });

    expect(plan.boundaryAngle).toBe(180);
    expect(plan.focusAngle).toBe(195);
    expect(plan.landingAngle).toBe(145);
    expect(localAngleAtPointer(plan.focusRotation)).toBe(195);
    expect(localAngleAtPointer(plan.boundaryRotation)).toBe(180);
    expect(localAngleAtPointer(plan.finalRotation)).toBe(145);
    expect(plan.focusRotation).toBeLessThan(plan.boundaryRotation);
    expect(plan.boundaryRotation).toBeLessThan(plan.finalRotation);
  });

  it('normalizes the first winner landing across the zero-degree wrap', () => {
    const plan = buildRouletteFinishPlan(720, 0, 3, 1, [1, 2, 1], {
      entryGapDegrees: 18,
      leadDegrees: 9,
    });

    expect(plan.boundaryAngle).toBe(0);
    expect(localAngleAtPointer(plan.focusRotation)).toBe(18);
    expect(localAngleAtPointer(plan.boundaryRotation)).toBe(0);
    expect(localAngleAtPointer(plan.finalRotation)).toBe(351);
  });

  it('handles the last winner entering through the first slice after wrap', () => {
    const plan = buildRouletteFinishPlan(0, 2, 3, 1, [1, 2, 1], {
      entryGapDegrees: 24,
      leadDegrees: 11,
    });

    expect(plan.boundaryAngle).toBe(270);
    expect(plan.focusAngle).toBe(294);
    expect(plan.landingAngle).toBe(259);
    expect(localAngleAtPointer(plan.focusRotation)).toBe(294);
    expect(localAngleAtPointer(plan.boundaryRotation)).toBe(270);
    expect(localAngleAtPointer(plan.finalRotation)).toBe(259);
  });

  it('clamps the landing inside an extremely narrow winning slice', () => {
    const plan = buildRouletteFinishPlan(0, 1, 2, 1, [999, 1], {
      entryGapDegrees: 20,
      leadDegrees: 50,
    });
    const winner = getRouletteSliceGeometry(2, [999, 1])[1];
    const winnerSpan = winner.endAngle - winner.startAngle;

    expect(plan.leadDegrees).toBeCloseTo(winnerSpan * 0.9, 10);
    expect(plan.landingAngle).toBeGreaterThan(winner.startAngle);
    expect(plan.landingAngle).toBeLessThan(winner.endAngle);
    expect(localAngleAtPointer(plan.finalRotation)).toBeCloseTo(normalized(plan.landingAngle), 10);
  });

  it('clamps focus inside a narrow wrapped neighbour', () => {
    const plan = buildRouletteFinishPlan(0, 1, 2, 1, [1, 999], {
      entryGapDegrees: 50,
      leadDegrees: 20,
    });
    const firstSlice = getRouletteSliceGeometry(2, [1, 999])[0];
    const firstSpan = firstSlice.endAngle - firstSlice.startAngle;

    expect(plan.entryGapDegrees).toBeCloseTo(firstSpan * 0.9, 10);
    expect(plan.focusRotation).toBeLessThan(plan.boundaryRotation);
    expect(plan.boundaryRotation).toBeLessThan(plan.finalRotation);
  });

  it('keeps zero-distance requests off the exact boundary', () => {
    const plan = buildRouletteFinishPlan(0, 0, 4, 0, undefined, {
      entryGapDegrees: 0,
      leadDegrees: 0,
    });

    expect(plan.entryGapDegrees).toBeGreaterThan(0);
    expect(plan.leadDegrees).toBeGreaterThan(0);
    expect(plan.focusRotation).toBeLessThan(plan.boundaryRotation);
    expect(plan.boundaryRotation).toBeLessThan(plan.finalRotation);
  });
});

describe('calculateDartPostImpactDuration', () => {
  it('matches the incoming linear speed when the duration is not clamped', () => {
    const flightDistance = 800;
    const coastDistance = 405;
    const duration = calculateDartPostImpactDuration(flightDistance, coastDistance);
    const incomingVelocity = flightDistance / DART_FLIGHT_DURATION_SECONDS;
    const firstCoastVelocity = (2 * coastDistance) / duration;

    expect(duration).toBeGreaterThan(1.05);
    expect(duration).toBeLessThan(2.35);
    expect(firstCoastVelocity).toBeCloseTo(incomingVelocity, 10);
  });

  it('never makes the first coast velocity faster at the supported extremes', () => {
    for (const [flightDistance, coastDistance] of [
      [720, 540],
      [1_440, 360.1],
    ]) {
      const duration = calculateDartPostImpactDuration(flightDistance, coastDistance);
      const incomingVelocity = flightDistance / DART_FLIGHT_DURATION_SECONDS;
      const firstCoastVelocity = (2 * coastDistance) / duration;

      expect(firstCoastVelocity).toBeLessThanOrEqual(incomingVelocity + 1e-10);
    }
  });
});
