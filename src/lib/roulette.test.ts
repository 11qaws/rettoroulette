import { describe, expect, it } from 'vitest';

import {
  AUTO_POINTER_ANGLE,
  AUTO_PHOTO_FINISH_MIN_SECONDS,
  DART_IMPACT_ANGLE,
  DART_FLIGHT_DURATION_SECONDS,
  PHOTO_FINISH_MAX_LEAD_DEGREES,
  buildCommittedDartRouletteFinishPlan,
  buildDartRouletteFinishPlan,
  buildRouletteFinishPlan,
  calculateAutoPhotoFinishTiming,
  calculateDartFlightTiming,
  calculateDartPostImpactDuration,
  createDartAimSession,
  createDartPhysicalCommit,
  createDartShotPlan,
  createRouletteFinishLanding,
  createRouletteGeometrySignature,
  getRouletteSliceGeometry,
  getRouletteSliceIndexAtScreenAngle,
  isRoulettePhotoFinish,
  nextWheelRotation,
  normalizeRouletteWeights,
  resolveDartImpactPoint,
  sampleDartAimSession,
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

  it('signs the normalized physical geometry rather than raw weight scale', () => {
    expect(createRouletteGeometrySignature(3, [1, 2, 1])).toBe(
      createRouletteGeometrySignature(3, [10, 20, 10]),
    );
    expect(createRouletteGeometrySignature(3, [1, 2, 1])).not.toBe(
      createRouletteGeometrySignature(3, [2, 1, 1]),
    );
  });
});

const normalized = (angle: number) => ((angle % 360) + 360) % 360;
const localAngleAtPointer = (rotation: number) => normalized(AUTO_POINTER_ANGLE - rotation);
const localAngleAt = (screenAngle: number, rotation: number) => normalized(screenAngle - rotation);

describe('dart shot placement', () => {
  it('keeps generated shots inside the safe upper arc and jitter bounds', () => {
    const low = createDartShotPlan(() => 0);
    const high = createDartShotPlan(() => 1);

    expect(low.impactAngleDegrees).toBe(-115);
    expect(high.impactAngleDegrees).toBe(-65);
    expect(low.impactRadiusRatio).toBe(0.58);
    expect(high.impactRadiusRatio).toBeCloseTo(0.8, 10);
    expect(low.jitterA).toEqual({ xPixels: -7, yPixels: -5 });
    expect(high.jitterB).toEqual({ xPixels: 7, yPixels: 5 });
    expect(low.rollDegrees).toBe(-12);
    expect(high.rollDegrees).toBe(12);
  });

  it('derives one screen point from the canonical angle and radius', () => {
    const point = resolveDartImpactPoint({
      impactAngleDegrees: -90,
      impactRadiusRatio: 0.72,
      jitterA: { xPixels: 2, yPixels: -3 },
      jitterB: { xPixels: -4, yPixels: 5 },
      rollDegrees: 6,
    });

    expect(point.xPercent).toBeCloseTo(50, 10);
    expect(point.yPercent).toBeCloseTo(14, 10);
    expect(point.finalXPercent).toBe(50);
    expect(point.finalYPercent).toBeCloseTo(14, 10);
    expect(point.jitterA).toEqual({ xPixels: 2, yPixels: -3 });
  });
});

describe('result-neutral landing variety', () => {
  const sequence = (...values: number[]) => {
    let index = 0;
    return () => values[Math.min(index++, values.length - 1)] ?? 0.5;
  };

  it('samples both boundary sides and the interior without touching winner odds', () => {
    const nearEnd = createRouletteFinishLanding('spin', sequence(0.1, 1, 0.5));
    const nearStart = createRouletteFinishLanding('spin', sequence(0.4, 1, 0.5));
    expect(nearEnd.kind).toBe('near-end');
    expect(nearStart.kind).toBe('near-start');
    expect(nearEnd.leadDegrees).toBeLessThanOrEqual(PHOTO_FINISH_MAX_LEAD_DEGREES);
    expect(nearStart.leadDegrees).toBeLessThanOrEqual(PHOTO_FINISH_MAX_LEAD_DEGREES);
    expect(isRoulettePhotoFinish(true, 8, buildRouletteFinishPlan(0, 0, 8, 4, undefined, nearEnd))).toBe(true);
    expect(isRoulettePhotoFinish(true, 8, buildRouletteFinishPlan(0, 0, 8, 4, undefined, nearStart))).toBe(true);
    const interior = createRouletteFinishLanding('spin', sequence(0.8, 0.25));
    expect(interior.kind).toBe('interior');
    expect(interior.positionRatio).toBeCloseTo(0.37, 10);

    expect(createRouletteFinishLanding('dart', sequence(0.1, 0.5, 0.5)).kind).toBe('near-end');
    expect(createRouletteFinishLanding('dart', sequence(0.2, 0.5, 0.5)).kind).toBe('near-start');
    expect(createRouletteFinishLanding('dart', sequence(0.7, 0.5)).kind).toBe('interior');
  });

  it('keeps a deterministic moving aim inside the visible safe arc', () => {
    let randomState = 17;
    const aim = createDartAimSession(7, 1_000, () => {
      randomState = (randomState * 48271) % 0x7fffffff;
      return randomState / 0x7fffffff;
    });
    const first = sampleDartAimSession(aim, 1_000);
    const repeated = sampleDartAimSession(aim, 1_000);
    expect(first).toEqual(repeated);

    for (let time = 1_000; time <= 12_000; time += 137) {
      const shot = sampleDartAimSession(aim, time);
      expect(shot.impactAngleDegrees).toBeGreaterThanOrEqual(-115);
      expect(shot.impactAngleDegrees).toBeLessThanOrEqual(-65);
      expect(shot.impactRadiusRatio).toBeGreaterThanOrEqual(0.58);
      expect(shot.impactRadiusRatio).toBeLessThanOrEqual(0.8);
    }
  });

  it('moves between random aim waypoints without a frame-sized teleport', () => {
    let randomState = 29;
    const aim = createDartAimSession(8, 0, () => {
      randomState = (randomState * 48271) % 0x7fffffff;
      return randomState / 0x7fffffff;
    });
    let previous = resolveDartImpactPoint(sampleDartAimSession(aim, 0));
    let maximumStep = 0;

    for (let time = 16; time <= 8_000; time += 16) {
      const current = resolveDartImpactPoint(sampleDartAimSession(aim, time));
      maximumStep = Math.max(
        maximumStep,
        Math.hypot(current.xPercent - previous.xPercent, current.yPercent - previous.yPercent),
      );
      previous = current;
    }

    expect(maximumStep).toBeLessThan(0.9);
  });
});

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

    expect(plan.leadDegrees).toBeCloseTo(winnerSpan / 2, 10);
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

  it('uses a clear final proof point while keeping narrow winners centred', () => {
    const broad = buildRouletteFinishPlan(0, 0, 5, 2, undefined, {
      entryGapDegrees: 14,
      leadDegrees: 0.4,
      minimumProofLeadDegrees: 4,
      boundaryHit: true,
    });
    const narrow = buildRouletteFinishPlan(0, 1, 2, 2, [99, 1], {
      entryGapDegrees: 14,
      leadDegrees: 0.4,
      minimumProofLeadDegrees: 4,
      boundaryHit: true,
    });
    const narrowWinner = getRouletteSliceGeometry(2, [99, 1])[1];

    expect(broad.leadDegrees).toBe(4);
    expect(narrow.leadDegrees).toBeCloseTo(
      (narrowWinner.endAngle - narrowWinner.startAngle) / 2,
      10,
    );
  });

  it('keeps the committed winner under the twelve-o-clock pointer for representative wheels', () => {
    for (const participantCount of [2, 3, 4, 5, 8, 10]) {
      const weightSets = [
        undefined,
        Array.from({ length: participantCount }, (_, index) => index + 1),
      ];

      for (const weights of weightSets) {
        for (let winnerIndex = 0; winnerIndex < participantCount; winnerIndex += 1) {
          const plan = buildRouletteFinishPlan(137.25, winnerIndex, participantCount, 4, weights, {
            entryGapDegrees: 15,
            leadDegrees: 0.5,
            minimumProofLeadDegrees: 4,
            boundaryHit: true,
          });

          expect(getRouletteSliceIndexAtScreenAngle(
            plan.finalRotation,
            participantCount,
            weights,
          )).toBe(winnerIndex);
        }
      }
    }
  });

  it('supports both physical boundary sides and interior stops without reversing', () => {
    for (const participantCount of [2, 3, 5, 8, 10]) {
      const weightSets = [
        undefined,
        Array.from({ length: participantCount }, (_, index) => index + 1),
      ];
      for (const weights of weightSets) {
        for (const winnerIndex of [0, Math.floor(participantCount / 2), participantCount - 1]) {
          const landings = [
            { kind: 'near-end' as const, entryGapDegrees: 14, leadDegrees: 2.4, boundaryHit: true },
            { kind: 'near-start' as const, entryGapDegrees: 14, leadDegrees: 2.4, boundaryHit: true },
            { kind: 'interior' as const, positionRatio: 0.43, entryGapDegrees: 0, leadDegrees: 0, boundaryHit: false },
          ];

          for (const landing of landings) {
            const plan = buildRouletteFinishPlan(
              137.25,
              winnerIndex,
              participantCount,
              4,
              weights,
              landing,
            );
            expect(plan.finalRotation).toBeGreaterThanOrEqual(plan.focusRotation);
            expect(getRouletteSliceIndexAtScreenAngle(
              plan.finalRotation,
              participantCount,
              weights,
            )).toBe(winnerIndex);

            if (landing.kind === 'near-end') {
              expect(plan.crossesBoundary).toBe(true);
              expect(plan.winnerDisplaySide).toBe('left');
              expect(plan.adjacentIndex).toBe((winnerIndex + 1) % participantCount);
              expect(plan.boundaryRotation).toBeLessThan(plan.finalRotation);
            } else if (landing.kind === 'near-start') {
              expect(plan.crossesBoundary).toBe(false);
              expect(plan.winnerDisplaySide).toBe('right');
              expect(plan.adjacentIndex).toBe((winnerIndex - 1 + participantCount) % participantCount);
              expect(plan.finalRotation).toBeLessThan(plan.boundaryRotation);
            } else {
              expect(plan.boundarySide).toBeNull();
              expect(plan.adjacentIndex).toBeNull();
              expect(plan.winnerDisplaySide).toBeNull();
            }
          }
        }
      }
    }
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

  it('matches the brake exit speed to a two-second boundary tension beat', () => {
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

    expect(timing.photoFinishDuration).toBeGreaterThanOrEqual(AUTO_PHOTO_FINISH_MIN_SECONDS);
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
  it('carries the same wheel-local dart from impact to the twelve-o’clock stop', () => {
    const plan = buildDartRouletteFinishPlan(137, 2, 6, 3, 3, undefined, {
      entryGapDegrees: 4,
      leadDegrees: 3,
    });

    expect(plan.impactRotation).toBe(plan.boundaryRotation);
    expect(plan.finalRotation - plan.impactRotation).toBeGreaterThanOrEqual(3 * 360);
    expect(localAngleAt(plan.impactAngleDegrees, plan.impactRotation)).toBeCloseTo(
      plan.landingAngle,
      10,
    );
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

  it('aligns varied impact angles with the same committed winner and wheel-local point', () => {
    for (const impactAngleDegrees of [-115, -90, -65]) {
      const shot = {
        impactAngleDegrees,
        impactRadiusRatio: 0.72,
        jitterA: { xPixels: 3, yPixels: -2 },
        jitterB: { xPixels: -4, yPixels: 1 },
        rollDegrees: 5,
      };
      const plan = buildDartRouletteFinishPlan(
        221,
        2,
        5,
        3,
        2,
        [1, 2, 1, 3, 1],
        { entryGapDegrees: 9, leadDegrees: 0.6, boundaryHit: true },
        shot,
      );

      expect(plan.impactAngleDegrees).toBe(impactAngleDegrees);
      expect(localAngleAt(impactAngleDegrees, plan.impactRotation)).toBeCloseTo(
        normalized(plan.landingAngle),
        10,
      );
      expect(localAngleAt(AUTO_POINTER_ANGLE, plan.finalRotation)).toBeCloseTo(
        normalized(plan.landingAngle),
        10,
      );
      expect(plan.finalRotation - plan.impactRotation).toBeGreaterThanOrEqual(720);
    }
  });

  it('keeps the faster pre-impact wheel linear inside the flight window', () => {
    const timing = calculateDartFlightTiming(84, 1080);

    expect(timing.duration).toBeGreaterThanOrEqual(1);
    expect(timing.duration).toBeLessThanOrEqual(1.3);
    expect(timing.distance / timing.duration).toBeCloseTo(1080, 10);
  });
});

describe('physical dart commit', () => {
  const shot = {
    impactAngleDegrees: -91,
    impactRadiusRatio: 0.71,
    jitterA: { xPixels: 2, yPixels: -1 },
    jitterB: { xPixels: -3, yPixels: 2 },
    rollDegrees: 4,
  };

  it('uses the predicted impact itself to select and preserve the winner', () => {
    const seenKinds = new Set<string>();

    for (let rotation = 0; rotation < 360; rotation += 1) {
      const commit = createDartPhysicalCommit(rotation, 1080, 5, undefined, shot);
      expect(commit).not.toBeNull();
      if (!commit) continue;
      seenKinds.add(commit.landing.kind ?? 'legacy');
      expect(getRouletteSliceIndexAtScreenAngle(
        commit.impactRotation,
        5,
        undefined,
        commit.shot.impactAngleDegrees,
      )).toBe(commit.winnerIndex);

      const plan = buildCommittedDartRouletteFinishPlan(commit, 5, 2);
      expect(plan.impactRotation).toBe(commit.impactRotation);
      expect(localAngleAt(plan.impactAngleDegrees, plan.impactRotation)).toBeCloseTo(
        normalized(plan.landingAngle),
        8,
      );
      expect(getRouletteSliceIndexAtScreenAngle(plan.finalRotation, 5)).toBe(commit.winnerIndex);
    }

    expect(seenKinds).toEqual(new Set(['near-start', 'near-end', 'interior']));
  });

  it('keeps weighted physical impacts inside the exact committed wedge', () => {
    const weights = [1, 4, 2, 3];
    for (const rotation of [0, 37, 122, 244, 359]) {
      const commit = createDartPhysicalCommit(rotation, 1080, 4, weights, shot);
      expect(commit).not.toBeNull();
      if (!commit) continue;
      expect(commit.geometrySignature).toBe(createRouletteGeometrySignature(4, weights));
      const plan = buildCommittedDartRouletteFinishPlan(commit, 4, 3, weights);
      expect(getRouletteSliceIndexAtScreenAngle(
        commit.impactRotation,
        4,
        weights,
        shot.impactAngleDegrees,
      )).toBe(commit.winnerIndex);
      expect(getRouletteSliceIndexAtScreenAngle(plan.finalRotation, 4, weights)).toBe(
        commit.winnerIndex,
      );
    }
  });

  it('adds result-neutral whole turns when rendering starts after the committed impact', () => {
    const commit = createDartPhysicalCommit(10, 1080, 5, undefined, shot);
    expect(commit).not.toBeNull();
    if (!commit) return;

    const delayedStart = commit.impactRotation + 45;
    const plan = buildCommittedDartRouletteFinishPlan(
      commit,
      5,
      2,
      undefined,
      delayedStart + 1080 * 0.42,
    );

    expect(plan.impactRotation).toBeGreaterThan(delayedStart);
    expect(plan.impactRotation - commit.impactRotation).toBeGreaterThanOrEqual(360);
    expect(getRouletteSliceIndexAtScreenAngle(
      plan.impactRotation,
      5,
      undefined,
      shot.impactAngleDegrees,
    )).toBe(commit.winnerIndex);
  });
});
