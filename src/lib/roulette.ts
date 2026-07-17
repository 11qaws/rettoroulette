export const AUTO_POINTER_ANGLE = -90;
export const DART_IMPACT_ANGLE = -42;

function normalizeAngle(angle: number) {
  return ((angle % 360) + 360) % 360;
}

/**
 * Places the centre of a wheel slice beneath a fixed presentation point.
 * The pointer and dart share this calculation; only the reveal changes.
 */
export function targetWheelRotation(
  winnerIndex: number,
  participantCount: number,
  impactAngle = AUTO_POINTER_ANGLE,
) {
  if (participantCount < 1 || winnerIndex < 0 || winnerIndex >= participantCount) return 0;

  const sliceAngle = 360 / participantCount;
  const winnerCentre = -90 + (winnerIndex + 0.5) * sliceAngle;
  return normalizeAngle(impactAngle - winnerCentre);
}

/** Adds visible turns without changing the final wedge placement. */
export function nextWheelRotation(
  currentRotation: number,
  winnerIndex: number,
  participantCount: number,
  fullTurns: number,
  impactAngle = AUTO_POINTER_ANGLE,
) {
  const target = targetWheelRotation(winnerIndex, participantCount, impactAngle);
  const current = normalizeAngle(currentRotation);
  const alignmentDelta = normalizeAngle(target - current);

  return currentRotation + Math.max(0, fullTurns) * 360 + alignmentDelta;
}
