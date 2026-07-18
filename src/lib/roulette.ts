export const AUTO_POINTER_ANGLE = -90;
export const DART_IMPACT_ANGLE = -90;
export const DART_FLIGHT_DURATION_SECONDS = 1.15;
export const DART_POST_IMPACT_MIN_SECONDS = 1.05;
export const DART_POST_IMPACT_MAX_SECONDS = 2.35;

export interface RouletteFinishLanding {
  /** How far outside the winning slice the close-up begins. */
  entryGapDegrees: number;
  /** How far the pointer travels into the winning slice before stopping. */
  leadDegrees: number;
  /** Requests the short boundary-hit callout without changing the result. */
  boundaryHit?: boolean;
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

export interface DartRouletteFinishPlan extends RouletteFinishPlan {
  /** Rotation when the fixed, front-facing dart reaches twelve o'clock. */
  impactRotation: number;
  /** Whole turns made with the dart physically attached to the board. */
  coastTurns: number;
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

/**
 * Matches the first velocity of a p(t)=2t-t² coast to the incoming linear
 * flight. Clamping can only make that first coast velocity slower, never
 * faster, for the supported one-turn-plus-half-slice finish distance.
 */
export function calculateDartPostImpactDuration(
  flightDistance: number,
  coastDistance: number,
) {
  const safeFlightDistance = Math.max(1, finiteNonNegative(flightDistance, 1));
  const safeCoastDistance = finiteNonNegative(coastDistance, 0);
  const impactVelocity = safeFlightDistance / DART_FLIGHT_DURATION_SECONDS;
  const matchedDuration = (2 * safeCoastDistance) / impactVelocity;

  return clamp(
    matchedDuration,
    DART_POST_IMPACT_MIN_SECONDS,
    DART_POST_IMPACT_MAX_SECONDS,
  );
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

  // Leave ten per cent of either wedge untouched so the focus and final
  // positions remain unambiguously on their intended sides of the boundary.
  const minimumEntryGap = Math.min(0.1, nextSpan * 0.1);
  const minimumLead = Math.min(0.1, winnerSpan * 0.1);
  const entryGapDegrees = clamp(requestedEntryGap, minimumEntryGap, nextSpan * 0.9);
  const leadDegrees = clamp(requestedLead, minimumLead, winnerSpan * 0.9);
  const boundaryAngle = winner.endAngle;
  const focusAngle = boundaryAngle + entryGapDegrees;
  const landingAngle = boundaryAngle - leadDegrees;
  const focusTarget = normalizeAngle(AUTO_POINTER_ANGLE - focusAngle);
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
 * The committed winner is already beneath the fixed twelve-o'clock impact
 * point when the dart lands. The board then makes only whole turns, so an
 * embedded dart can live in the board's local coordinate system and return to
 * the same point when the wheel stops. No visual re-aiming is needed after
 * impact and the dart can never drift away from its winning slice.
 */
export function buildDartRouletteFinishPlan(
  currentRotation: number,
  winnerIndex: number,
  participantCount: number,
  flightTurns: number,
  coastTurns: number,
  weights?: readonly number[],
  landing?: RouletteFinishLanding,
): DartRouletteFinishPlan {
  const landingPlan = buildRouletteFinishPlan(
    currentRotation,
    winnerIndex,
    participantCount,
    flightTurns,
    weights,
    landing,
  );
  const safeCoastTurns = Math.max(1, Math.floor(finiteNonNegative(coastTurns, 1)));
  const impactRotation = landingPlan.finalRotation;

  return {
    ...landingPlan,
    focusRotation: impactRotation,
    boundaryRotation: impactRotation,
    finalRotation: impactRotation + safeCoastTurns * 360,
    impactRotation,
    coastTurns: safeCoastTurns,
  };
}
