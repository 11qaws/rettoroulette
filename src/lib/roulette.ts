export const AUTO_POINTER_ANGLE = -90;
export const DART_IMPACT_ANGLE = -90;
export const DART_FLIGHT_DURATION_SECONDS = 1.15;
export const DART_POST_IMPACT_MIN_SECONDS = 1.05;
export const DART_POST_IMPACT_MAX_SECONDS = 2.35;
export const PHOTO_FINISH_MAX_LEAD_DEGREES = 0.9;
export const AUTO_PHOTO_FINISH_MIN_SECONDS = 1.45;

export interface DartFlightTiming {
  /** Whole turns added before the selected local landing reaches twelve. */
  fullTurns: number;
  /** Total positive rotor travel before impact. */
  distance: number;
  /** Exact time needed to keep the requested cruise velocity. */
  duration: number;
  /** Constant pre-impact angular velocity. */
  angularVelocity: number;
}

export interface RouletteFinishLanding {
  /** How far outside the winning slice the close-up begins. */
  entryGapDegrees: number;
  /** How far the pointer travels into the winning slice before stopping. */
  leadDegrees: number;
  /**
   * Optional final-proof clearance for an animated boundary crossing.
   * Narrow wedges use their centre instead of crossing a second boundary.
   */
  minimumProofLeadDegrees?: number;
  /** Requests the short boundary-hit callout without changing the result. */
  boundaryHit?: boolean;
}

export interface DartShotPlan {
  /** Screen-space angle of the committed impact point; -90 is twelve o'clock. */
  impactAngleDegrees: number;
  /** Distance from the wheel centre where 1 reaches the coloured outer edge. */
  impactRadiusRatio: number;
  /** Two result-neutral approach offsets that must converge to zero at contact. */
  jitterA: { xPixels: number; yPixels: number };
  jitterB: { xPixels: number; yPixels: number };
  /** Small face-on roll shared by the flying and embedded dart. */
  rollDegrees: number;
}

export interface DartImpactPoint extends DartShotPlan {
  xPercent: number;
  yPercent: number;
  /** Where the same board-local dart arrives when the winner stops at twelve. */
  finalXPercent: number;
  finalYPercent: number;
}

export interface RouletteFinishPlan {
  /** Close-up position, still inside the clockwise neighbour of the winner. */
  focusRotation: number;
  /** Position where the winning slice's trailing boundary reaches the pointer. */
  boundaryRotation: number;
  /** Final position, safely inside the winning slice. */
  finalRotation: number;
  /** Applied (clamped) distance before the winning boundary. */
  entryGapDegrees: number;
  /** Applied (clamped) distance inside the winning slice. */
  leadDegrees: number;
  /** Wheel-local angle beneath the pointer during the close-up. */
  focusAngle: number;
  /** Wheel-local angle of the boundary used to enter the winning slice. */
  boundaryAngle: number;
  /** Wheel-local angle beneath the pointer at the final stop. */
  landingAngle: number;
}

export interface AutoPhotoFinishTiming {
  brakeDuration: number;
  photoFinishDuration: number;
  photoFinishEntryVelocity: number;
  brakeBezier: string;
}

export interface DartRouletteFinishPlan extends RouletteFinishPlan {
  /** Rotation when the fixed, front-facing dart reaches its varied impact point. */
  impactRotation: number;
  /** Whole turns made with the dart physically attached to the board. */
  coastTurns: number;
  /** The same screen-space point used by the projectile and camera. */
  impactAngleDegrees: number;
  impactRadiusRatio: number;
}

export interface RouletteSliceGeometry {
  index: number;
  weight: number;
  startAngle: number;
  endAngle: number;
  centreAngle: number;
}

function normalizeAngle(angle: number) {
  return ((angle % 360) + 360) % 360;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNonNegative(value: number, fallback: number) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function finiteClamped(value: number, minimum: number, maximum: number, fallback: number) {
  return Number.isFinite(value) ? clamp(value, minimum, maximum) : fallback;
}

function nextUnitRandom(random: () => number) {
  return finiteClamped(random(), 0, 1, 0.5);
}

/**
 * Creates one result-neutral dart shot after the draw winner has been fixed.
 * Keeping the point on the upper half preserves the readable left/right
 * boundary direction while making consecutive shots visibly distinct.
 */
export function createDartShotPlan(random: () => number = Math.random): DartShotPlan {
  return {
    impactAngleDegrees: -115 + nextUnitRandom(random) * 50,
    impactRadiusRatio: 0.58 + nextUnitRandom(random) * 0.22,
    jitterA: {
      xPixels: (nextUnitRandom(random) * 2 - 1) * 7,
      yPixels: (nextUnitRandom(random) * 2 - 1) * 5,
    },
    jitterB: {
      xPixels: (nextUnitRandom(random) * 2 - 1) * 7,
      yPixels: (nextUnitRandom(random) * 2 - 1) * 5,
    },
    rollDegrees: -12 + nextUnitRandom(random) * 24,
  };
}

/** Converts the canonical polar shot into the one shared CSS impact point. */
export function resolveDartImpactPoint(shot?: DartShotPlan): DartImpactPoint {
  const impactAngleDegrees = finiteClamped(
    shot?.impactAngleDegrees ?? DART_IMPACT_ANGLE,
    -115,
    -65,
    DART_IMPACT_ANGLE,
  );
  const impactRadiusRatio = finiteClamped(
    shot?.impactRadiusRatio ?? 0.72,
    0.58,
    0.8,
    0.72,
  );
  const angleInRadians = (impactAngleDegrees * Math.PI) / 180;

  return {
    impactAngleDegrees,
    impactRadiusRatio,
    xPercent: 50 + Math.cos(angleInRadians) * impactRadiusRatio * 50,
    yPercent: 50 + Math.sin(angleInRadians) * impactRadiusRatio * 50,
    finalXPercent: 50,
    finalYPercent: 50 - impactRadiusRatio * 50,
    jitterA: {
      xPixels: finiteClamped(shot?.jitterA.xPixels ?? 0, -7, 7, 0),
      yPixels: finiteClamped(shot?.jitterA.yPixels ?? 0, -5, 5, 0),
    },
    jitterB: {
      xPixels: finiteClamped(shot?.jitterB.xPixels ?? 0, -7, 7, 0),
      yPixels: finiteClamped(shot?.jitterB.yPixels ?? 0, -5, 5, 0),
    },
    rollDegrees: finiteClamped(shot?.rollDegrees ?? 0, -12, 12, 0),
  };
}

/**
 * Matches the first velocity of a p(t)=2t-t² coast to the incoming linear
 * flight. A minimum duration can only make that first coast velocity slower;
 * there is deliberately no upper clamp that could reaccelerate the rotor.
 */
export function calculateDartPostImpactDuration(
  flightDistance: number,
  coastDistance: number,
  flightDuration = DART_FLIGHT_DURATION_SECONDS,
) {
  const safeFlightDistance = Math.max(1, finiteNonNegative(flightDistance, 1));
  const safeCoastDistance = finiteNonNegative(coastDistance, 0);
  const safeFlightDuration = Math.max(
    0.001,
    finiteNonNegative(flightDuration, DART_FLIGHT_DURATION_SECONDS),
  );
  const impactVelocity = safeFlightDistance / safeFlightDuration;
  const matchedDuration = (2 * safeCoastDistance) / impactVelocity;

  // A minimum may make the brake gentler. An upper clamp could make its first
  // frame faster than impact, so continuity wins over a hard maximum.
  return Math.max(DART_POST_IMPACT_MIN_SECONDS, matchedDuration);
}

/**
 * Picks the visible whole-turn count, then derives time from distance/speed.
 * The rotor therefore keeps its cruise velocity all the way to impact instead
 * of slowing down or accelerating to satisfy a hard-coded animation length.
 */
export function calculateDartFlightTiming(
  baseImpactDistance: number,
  cruiseVelocity: number,
  minimumDuration = 1,
  maximumDuration = 1.3,
  maximumAdditionalTurns = 4,
): DartFlightTiming {
  const safeBaseDistance = finiteNonNegative(baseImpactDistance, 0);
  const safeVelocity = Math.max(1, finiteNonNegative(cruiseVelocity, 1));
  const safeMinimum = Math.max(0, finiteNonNegative(minimumDuration, 1));
  const safeMaximum = Math.max(
    safeMinimum,
    finiteNonNegative(maximumDuration, 1.3),
  );
  const targetDuration = (safeMinimum + safeMaximum) / 2;
  const lastTurn = Math.max(
    0,
    Math.floor(finiteNonNegative(maximumAdditionalTurns, 4)),
  );

  let best: DartFlightTiming | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let fullTurns = 0; fullTurns <= lastTurn; fullTurns += 1) {
    const distance = safeBaseDistance + fullTurns * 360;
    const duration = distance / safeVelocity;
    const outsideWindow = duration < safeMinimum
      ? safeMinimum - duration
      : duration > safeMaximum
        ? duration - safeMaximum
        : 0;
    // Staying inside the requested window matters more than proximity to its
    // centre. The secondary score keeps the shot close to the 1.15s target.
    const score = outsideWindow * 100 + Math.abs(duration - targetDuration);

    if (score < bestScore) {
      bestScore = score;
      best = {
        fullTurns,
        distance,
        duration,
        angularVelocity: safeVelocity,
      };
    }
  }

  return best ?? {
    fullTurns: 0,
    distance: safeBaseDistance,
    duration: safeBaseDistance / safeVelocity,
    angularVelocity: safeVelocity,
  };
}

export function isRoulettePhotoFinish(
  requested: boolean | undefined,
  participantCount: number,
  plan: RouletteFinishPlan,
) {
  return Boolean(
    requested
    && participantCount > 1
    && plan.leadDegrees <= PHOTO_FINISH_MAX_LEAD_DEGREES,
  );
}

/**
 * Matches the end velocity of the high-speed brake to the first velocity of
 * the final quadratic creep. This prevents a visual speed jump between the
 * two physical auto-wheel stages.
 */
export function calculateAutoPhotoFinishTiming(
  startingRotation: number,
  plan: RouletteFinishPlan,
  startingVelocity: number,
): AutoPhotoFinishTiming {
  const safeStartingVelocity = Math.max(1, finiteNonNegative(startingVelocity, 1));
  const brakeDistance = Math.max(1, plan.focusRotation - startingRotation);
  const photoFinishDistance = Math.max(0.1, plan.finalRotation - plan.focusRotation);
  const photoFinishDuration = AUTO_PHOTO_FINISH_MIN_SECONDS
    + Math.min(0.3, photoFinishDistance / 90);
  const photoFinishEntryVelocity = (2 * photoFinishDistance) / photoFinishDuration;
  const brakeDuration = Math.max(
    2.8,
    Math.min(4.9, (2 * brakeDistance) / (safeStartingVelocity + photoFinishEntryVelocity)),
  );
  const velocitySum = safeStartingVelocity + photoFinishEntryVelocity;
  const y1 = (2 * safeStartingVelocity) / (3 * velocitySum);
  const y2 = 1 - (2 * photoFinishEntryVelocity) / (3 * velocitySum);

  return {
    brakeDuration,
    photoFinishDuration,
    photoFinishEntryVelocity,
    brakeBezier: `cubic-bezier(0.3333, ${y1.toFixed(4)}, 0.6667, ${y2.toFixed(4)})`,
  };
}

/**
 * Returns one non-negative, normalized weight per visible option. Missing
 * weights retain the original equal-size roulette behaviour.
 */
export function normalizeRouletteWeights(
  participantCount: number,
  weights?: readonly number[],
) {
  if (participantCount < 1) return [];

  if (!weights || weights.length !== participantCount) {
    return Array.from({ length: participantCount }, () => 1 / participantCount);
  }

  const positiveWeights = weights.map((weight) => (
    Number.isFinite(weight) && weight > 0 ? weight : 0
  ));
  const total = positiveWeights.reduce((sum, weight) => sum + weight, 0);

  if (total <= 0) {
    return Array.from({ length: participantCount }, () => 1 / participantCount);
  }

  return positiveWeights.map((weight) => weight / total);
}

/**
 * Calculates every wedge from the same normalized weights used by the draw.
 * Slice zero begins at the usual twelve-o'clock origin (-90 degrees).
 */
export function getRouletteSliceGeometry(
  participantCount: number,
  weights?: readonly number[],
): RouletteSliceGeometry[] {
  const normalizedWeights = normalizeRouletteWeights(participantCount, weights);
  let startAngle = -90;

  return normalizedWeights.map((weight, index) => {
    const endAngle = startAngle + weight * 360;
    const geometry = {
      index,
      weight,
      startAngle,
      endAngle,
      centreAngle: startAngle + (endAngle - startAngle) / 2,
    };

    startAngle = endAngle;
    return geometry;
  });
}

/** Resolves the visible wedge beneath a fixed screen-space selection point. */
export function getRouletteSliceIndexAtScreenAngle(
  rotation: number,
  participantCount: number,
  weights?: readonly number[],
  screenAngle = AUTO_POINTER_ANGLE,
) {
  if (participantCount < 1 || !Number.isFinite(rotation) || !Number.isFinite(screenAngle)) {
    return -1;
  }

  const normalizedLocalAngle = normalizeAngle(screenAngle - rotation);
  const localAngle = normalizedLocalAngle >= 270 ? normalizedLocalAngle - 360 : normalizedLocalAngle;
  const epsilon = 1e-9;

  return getRouletteSliceGeometry(participantCount, weights).findIndex((slice) => (
    localAngle >= slice.startAngle - epsilon
    && localAngle < slice.endAngle - epsilon
  ));
}

/**
 * Places the centre of a wheel slice beneath a fixed presentation point.
 * The pointer and dart share this calculation; only the reveal changes.
 */
export function targetWheelRotation(
  winnerIndex: number,
  participantCount: number,
  impactAngle = AUTO_POINTER_ANGLE,
  weights?: readonly number[],
) {
  if (participantCount < 1 || winnerIndex < 0 || winnerIndex >= participantCount) return 0;

  const winner = getRouletteSliceGeometry(participantCount, weights)[winnerIndex];
  return normalizeAngle(impactAngle - winner.centreAngle);
}

/** Adds visible turns without changing the final wedge placement. */
export function nextWheelRotation(
  currentRotation: number,
  winnerIndex: number,
  participantCount: number,
  fullTurns: number,
  impactAngle = AUTO_POINTER_ANGLE,
  weights?: readonly number[],
) {
  const target = targetWheelRotation(winnerIndex, participantCount, impactAngle, weights);
  const current = normalizeAngle(currentRotation);
  const alignmentDelta = normalizeAngle(target - current);

  return currentRotation + Math.max(0, fullTurns) * 360 + alignmentDelta;
}

/**
 * Builds the three clockwise positions used by the shared auto/dart finish.
 *
 * Positive wheel rotation makes the fixed pointer move backwards through the
 * wheel's local angles. The close-up therefore starts just beyond the
 * winner's end angle, crosses that boundary, and stops inside the winner.
 * Distances are clamped to their respective wedges so even very narrow or
 * wrap-around weighted slices cannot accidentally expose another result.
 */
export function buildRouletteFinishPlan(
  currentRotation: number,
  winnerIndex: number,
  participantCount: number,
  fullTurns: number,
  weights?: readonly number[],
  landing: RouletteFinishLanding = {
    entryGapDegrees: 8,
    leadDegrees: 12,
  },
  presentationAngle = AUTO_POINTER_ANGLE,
): RouletteFinishPlan {
  const safeCurrentRotation = Number.isFinite(currentRotation) ? currentRotation : 0;
  const slices = getRouletteSliceGeometry(participantCount, weights);
  const winner = slices[winnerIndex];

  if (!winner) {
    return {
      focusRotation: safeCurrentRotation,
      boundaryRotation: safeCurrentRotation,
      finalRotation: safeCurrentRotation,
      entryGapDegrees: 0,
      leadDegrees: 0,
      focusAngle: 0,
      boundaryAngle: 0,
      landingAngle: 0,
    };
  }

  const nextSlice = slices[(winnerIndex + 1) % slices.length];
  const winnerSpan = winner.endAngle - winner.startAngle;
  const nextSpan = nextSlice.endAngle - nextSlice.startAngle;
  const requestedEntryGap = finiteNonNegative(landing.entryGapDegrees, 8);
  const requestedLead = finiteNonNegative(landing.leadDegrees, 12);
  const requestedProofClearance = finiteNonNegative(landing.minimumProofLeadDegrees ?? 0, 0);

  // Leave ten per cent of either wedge untouched so the focus and final
  // positions remain unambiguously on their intended sides of the boundary.
  const minimumEntryGap = Math.min(0.1, nextSpan * 0.1);
  const minimumLead = Math.min(0.1, winnerSpan * 0.1);
  const proofClearance = Math.min(requestedProofClearance, winnerSpan / 2);
  const entryGapDegrees = clamp(requestedEntryGap, minimumEntryGap, nextSpan * 0.9);
  const leadDegrees = clamp(
    Math.max(requestedLead, proofClearance),
    minimumLead,
    winnerSpan * 0.9,
  );
  const boundaryAngle = winner.endAngle;
  const focusAngle = boundaryAngle + entryGapDegrees;
  const landingAngle = boundaryAngle - leadDegrees;
  const focusTarget = normalizeAngle(presentationAngle - focusAngle);
  const currentAngle = normalizeAngle(safeCurrentRotation);
  const alignmentDelta = normalizeAngle(focusTarget - currentAngle);
  const safeTurns = finiteNonNegative(fullTurns, 0);
  const focusRotation = safeCurrentRotation + safeTurns * 360 + alignmentDelta;
  const boundaryRotation = focusRotation + entryGapDegrees;
  const finalRotation = boundaryRotation + leadDegrees;

  return {
    focusRotation,
    boundaryRotation,
    finalRotation,
    entryGapDegrees,
    leadDegrees,
    focusAngle,
    boundaryAngle,
    landingAngle,
  };
}

/**
 * Builds a physically coupled dart finish.
 *
 * The committed winner is beneath a varied upper-half impact point when the
 * dart lands. The board then carries that embedded dart to twelve o'clock,
 * proving that the projectile and the final winner share one wheel-local
 * point. The dart never drifts away from its winning slice.
 */
export function buildDartRouletteFinishPlan(
  currentRotation: number,
  winnerIndex: number,
  participantCount: number,
  flightTurns: number,
  coastTurns: number,
  weights?: readonly number[],
  landing?: RouletteFinishLanding,
  shot?: DartShotPlan,
): DartRouletteFinishPlan {
  const impactPoint = resolveDartImpactPoint(shot);
  const landingPlan = buildRouletteFinishPlan(
    currentRotation,
    winnerIndex,
    participantCount,
    flightTurns,
    weights,
    landing,
    impactPoint.impactAngleDegrees,
  );
  const safeCoastTurns = Math.max(1, Math.floor(finiteNonNegative(coastTurns, 1)));
  const impactRotation = landingPlan.finalRotation;
  const finalPlan = buildRouletteFinishPlan(
    impactRotation,
    winnerIndex,
    participantCount,
    safeCoastTurns,
    weights,
    landing,
    AUTO_POINTER_ANGLE,
  );

  return {
    ...landingPlan,
    focusRotation: impactRotation,
    boundaryRotation: impactRotation,
    finalRotation: finalPlan.finalRotation,
    impactRotation,
    coastTurns: safeCoastTurns,
    impactAngleDegrees: impactPoint.impactAngleDegrees,
    impactRadiusRatio: impactPoint.impactRadiusRatio,
  };
}
