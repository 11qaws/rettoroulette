export const AUTO_POINTER_ANGLE = -90;
export const DART_IMPACT_ANGLE = -42;

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
