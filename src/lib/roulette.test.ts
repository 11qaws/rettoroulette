import { describe, expect, it } from 'vitest';

import {
  AUTO_POINTER_ANGLE,
  DART_IMPACT_ANGLE,
  DART_FLIGHT_DURATION_SECONDS,
  buildDartRouletteFinishPlan,
  buildRouletteFinishPlan,
  calculateAutoPhotoFinishTiming,
  calculateDartFlightTiming,
  calculateDartPostImpactDuration,
  getRouletteSliceGeometry,
  isRoulettePhotoFinish,
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

describe('auto roulette photo finish', () => {
  it('activates only for a genuinely near-boundary landing', () => {
    const near = buildRouletteFinishPlan(0, 0, 8, 4, undefined, {
      entryGapDegrees: 15,
      leadDegrees: 0.6,
      boundaryHit: true,
    });
    const ordinary = buildRouletteFinishPlan(0, 0, 8, 4, undefined, {
      entryGapDegrees: 15,
      leadDegrees: 8,
      boundaryHit: true,
    });

    expect(isRoulettePhotoFinish(true, 8, near)).toBe(true);
    expect(isRoulettePhotoFinish(false, 8, near)).toBe(false);
    expect(isRoulettePhotoFinish(true, 1, near)).toBe(false);
    expect(isRoulettePhotoFinish(true, 8, ordinary)).toBe(false);
  });

  it('matches the brake exit speed to a slow final creep lasting at least 1.45s', () => {
    const startingRotation = 0;
    const startingVelocity = 780;
    const plan = buildRouletteFinishPlan(startingRotation, 2, 10, 4, undefined, {
      entryGapDegrees: 16,
      leadDegrees: 0.5,
      boundaryHit: true,
    });
    const timing = calculateAutoPhotoFinishTiming(startingRotation, plan, startingVelocity);
    const brakeDistance = plan.focusRotation - startingRotation;
    const brakeExitVelocity = (2 * brakeDistance) / timing.brakeDuration - startingVelocity;

    expect(timing.photoFinishDuration).toBeGreaterThanOrEqual(1.45);
    expect(timing.brakeDuration).toBeGreaterThanOrEqual(2.8);
    expect(brakeExitVelocity).toBeCloseTo(timing.photoFinishEntryVelocity, 8);
    expect(plan.finalRotation - plan.boundaryRotation).toBeCloseTo(0.5, 10);
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

  it('matches a caller-supplied constant flight duration at impact', () => {
    const flightDistance = 936;
    const flightDuration = 1.2;
    const coastDistance = 624;
    const duration = calculateDartPostImpactDuration(
      flightDistance,
      coastDistance,
      flightDuration,
    );
    const incomingVelocity = flightDistance / flightDuration;
    const firstCoastVelocity = (2 * coastDistance) / duration;

    expect(firstCoastVelocity).toBeCloseTo(incomingVelocity, 10);
  });

  it('never reaccelerates even when continuity needs a longer brake', () => {
    const flightDistance = 360;
    const flightDuration = 1.2;
    const coastDistance = 720;
    const duration = calculateDartPostImpactDuration(
      flightDistance,
      coastDistance,
      flightDuration,
    );
    const incomingVelocity = flightDistance / flightDuration;
    const firstCoastVelocity = (2 * coastDistance) / duration;

    expect(duration).toBeGreaterThan(2.35);
    expect(firstCoastVelocity).toBeLessThanOrEqual(incomingVelocity);
  });
});

describe('calculateDartFlightTiming', () => {
  it('selects whole turns without changing the requested cruise speed', () => {
    const timing = calculateDartFlightTiming(84, 780);

    expect(timing.fullTurns).toBe(2);
    expect(timing.duration).toBeGreaterThanOrEqual(1);
    expect(timing.duration).toBeLessThanOrEqual(1.3);
    expect(timing.distance / timing.duration).toBeCloseTo(780, 10);
  });

  it('chooses the closest possible timing when no whole-turn option fits', () => {
    const timing = calculateDartFlightTiming(350, 120, 1, 1.3, 1);

    expect(timing.fullTurns).toBe(0);
    expect(timing.duration).toBeCloseTo(350 / 120, 10);
    expect(timing.angularVelocity).toBe(120);
  });

  it('keeps representative landing offsets inside the flight window', () => {
    for (const baseDistance of [60, 84, 179, 280, 455]) {
      const timing = calculateDartFlightTiming(baseDistance, 780);

      expect(timing.duration).toBeGreaterThanOrEqual(1);
      expect(timing.duration).toBeLessThanOrEqual(1.3);
      expect(timing.distance / timing.duration).toBeCloseTo(780, 10);
    }
  });
});

describe('buildDartRouletteFinishPlan', () => {
  it('keeps the embedded dart on the same wheel-local point through the coast', () => {
    const plan = buildDartRouletteFinishPlan(137, 2, 6, 3, 3, undefined, {
      entryGapDegrees: 4,
      leadDegrees: 3,
    });

    expect(plan.impactRotation).toBe(plan.boundaryRotation);
    expect(plan.finalRotation - plan.impactRotation).toBe(3 * 360);
    expect(localAngleAtPointer(plan.impactRotation)).toBeCloseTo(plan.landingAngle, 10);
    expect(localAngleAtPointer(plan.finalRotation)).toBeCloseTo(plan.landingAngle, 10);
  });

  it('preserves a weighted near-boundary landing without changing the winner', () => {
    const plan = buildDartRouletteFinishPlan(415, 1, 3, 3, 2, [1, 3, 1], {
      entryGapDegrees: 2,
      leadDegrees: 1.8,
    });

    expect(plan.leadDegrees).toBeCloseTo(1.8, 10);
    expect(plan.coastTurns).toBe(2);
    expect(localAngleAtPointer(plan.finalRotation)).toBeCloseTo(plan.landingAngle, 10);
  });
});
