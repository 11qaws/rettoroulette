export const AUTO_POINTER_ANGLE = -90;
export const DART_IMPACT_ANGLE = -90;
export const DART_FLIGHT_DURATION_SECONDS = 1.15;
export const DART_POST_IMPACT_MIN_SECONDS = 1.05;
export const DART_POST_IMPACT_MAX_SECONDS = 2.35;
export const PHOTO_FINISH_MAX_LEAD_DEGREES = 2.2;
/** The two boundary candidates must remain readable for roughly two seconds. */
export const AUTO_PHOTO_FINISH_MIN_SECONDS = 1.95;
export const DART_BOUNDARY_MAX_DEGREES = 2.2;

export type RouletteLandingKind = 'near-start' | 'near-end' | 'interior';
export type RouletteBoundarySide = 'start' | 'end';

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
  /** Physical region inside the already selected winning slice. */
  kind?: RouletteLandingKind;
  /** Exact normalized slice coordinate: 0 is start, 1 is end. */
  positionRatio?: number;
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

/** Result-neutral moving aim prepared before a dart winner exists. */
export interface DartAimSession {
  id: number;
  startedAt: number;
  /** Seeded hand-like waypoints; interpolation is C2 at every junction. */
  waypoints: Array<{ angleDegrees: number; radiusRatio: number }>;
  segmentDurationSeconds: number;
  jitterA: { xPixels: number; yPixels: number };
  jitterB: { xPixels: number; yPixels: number };
  rollDegrees: number;
}

/** Click-time physical result derived from the painted aim and live rotor. */
export interface DartPhysicalCommit {
  shot: DartShotPlan;
  impactRotation: number;
  flightDurationSeconds: number;
  /** Guards the rotor geometry used at click time from stale visual props. */
  geometrySignature: string;
  winnerIndex: number;
  landing: RouletteFinishLanding;
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
  landingKind: RouletteLandingKind;
  boundarySide: RouletteBoundarySide | null;
  adjacentIndex: number | null;
  winnerDisplaySide: 'left' | 'right' | null;
  crossesBoundary: boolean;
  boundaryDistanceDegrees: number;
  positionRatio: number;
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
 * Creates result-neutral finish variety only after an automatic winner exists.
 * Dart live draws use physical impact instead; this also drives deterministic
 * preview samples and keeps legacy callers on the same three-region model.
 */
export function createRouletteFinishLanding(
  presentation: 'spin' | 'dart',
  random: () => number = Math.random,
): RouletteFinishLanding {
  const regionRoll = nextUnitRandom(random);
  const firstBoundaryCut = presentation === 'spin' ? 0.3 : 0.15;
  const secondBoundaryCut = presentation === 'spin' ? 0.6 : 0.3;

  if (regionRoll < firstBoundaryCut || regionRoll < secondBoundaryCut) {
    const kind: RouletteLandingKind = regionRoll < firstBoundaryCut
      ? 'near-end'
      : 'near-start';
    const leadDegrees = presentation === 'spin'
      ? 0.35 + nextUnitRandom(random) * 1.3
      : 0.25 + nextUnitRandom(random) * 0.6;

    return {
      kind,
      entryGapDegrees: 10 + nextUnitRandom(random) * 8,
      leadDegrees,
      boundaryHit: true,
    };
  }

  return {
    kind: 'interior',
    positionRatio: 0.24 + nextUnitRandom(random) * 0.52,
    entryGapDegrees: 0,
    leadDegrees: 0,
    boundaryHit: false,
  };
}

/**
 * Creates one result-neutral static shot. Live draws normally freeze a sample
 * from a pre-draw DartAimSession; previews and compatibility tests may use it
 * directly.
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

export function createDartAimSession(
  id: number,
  startedAt: number,
  random: () => number = Math.random,
): DartAimSession {
  const waypoints = Array.from({ length: 7 }, () => ({
    angleDegrees: -112 + nextUnitRandom(random) * 44,
    radiusRatio: 0.6 + nextUnitRandom(random) * 0.18,
  }));

  return {
    id,
    startedAt: Number.isFinite(startedAt) ? startedAt : 0,
    waypoints,
    segmentDurationSeconds: 1.45 + nextUnitRandom(random) * 0.55,
    jitterA: {
      xPixels: 0,
      yPixels: 0,
    },
    jitterB: {
      xPixels: 0,
      yPixels: 0,
    },
    rollDegrees: -12 + nextUnitRandom(random) * 24,
  };
}

/** Deterministic motion: frame rate never consumes randomness or changes odds. */
export function sampleDartAimSession(session: DartAimSession, now: number): DartShotPlan {
  const elapsedSeconds = Math.max(0, (finiteNonNegative(now, session.startedAt) - session.startedAt) / 1_000);
  const points = session.waypoints.length >= 2
    ? session.waypoints
    : [
        { angleDegrees: DART_IMPACT_ANGLE, radiusRatio: 0.72 },
        { angleDegrees: DART_IMPACT_ANGLE, radiusRatio: 0.72 },
      ];
  const segmentDuration = Math.max(0.3, finiteNonNegative(session.segmentDurationSeconds, 0.9));
  const segmentPosition = elapsedSeconds / segmentDuration;
  const segmentIndex = Math.floor(segmentPosition) % points.length;
  const nextIndex = (segmentIndex + 1) % points.length;
  const linearProgress = segmentPosition - Math.floor(segmentPosition);
  // Smootherstep reaches every random waypoint with zero velocity and
  // acceleration, so a new direction never reads as a cursor teleport.
  const smoothProgress = linearProgress ** 3
    * (linearProgress * (linearProgress * 6 - 15) + 10);
  const currentPoint = points[segmentIndex];
  const nextPoint = points[nextIndex];
  const impactAngleDegrees = currentPoint.angleDegrees
    + (nextPoint.angleDegrees - currentPoint.angleDegrees) * smoothProgress;
  const impactRadiusRatio = currentPoint.radiusRatio
    + (nextPoint.radiusRatio - currentPoint.radiusRatio) * smoothProgress;

  return {
    impactAngleDegrees,
    impactRadiusRatio,
    jitterA: { ...session.jitterA },
    jitterB: { ...session.jitterB },
    rollDegrees: session.rollDegrees,
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
    && plan.landingKind !== 'interior'
    && plan.boundaryDistanceDegrees <= PHOTO_FINISH_MAX_LEAD_DEGREES,
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

/** Stable signature for the visible slice geometry used by a physical dart. */
export function createRouletteGeometrySignature(
  participantCount: number,
  weights?: readonly number[],
) {
  return normalizeRouletteWeights(participantCount, weights)
    .map((weight) => weight.toFixed(12))
    .join('|');
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
 * Commits the dart result from the painted target and the live rotor rather
 * than rotating a preselected winner into place. The result is still known
 * and persistable at click time, before any reveal animation begins.
 */
export function createDartPhysicalCommit(
  currentRotation: number,
  angularVelocity: number,
  participantCount: number,
  weights: readonly number[] | undefined,
  shot: DartShotPlan,
  flightDurationSeconds = DART_FLIGHT_DURATION_SECONDS,
): DartPhysicalCommit | null {
  if (participantCount < 1) return null;

  const safeRotation = Number.isFinite(currentRotation) ? currentRotation : 0;
  const safeVelocity = Math.max(1, finiteNonNegative(angularVelocity, 1));
  const safeDuration = finiteClamped(flightDurationSeconds, 1, 1.3, DART_FLIGHT_DURATION_SECONDS);
  const impactPoint = resolveDartImpactPoint(shot);
  const impactRotation = safeRotation + safeVelocity * safeDuration;
  const winnerIndex = getRouletteSliceIndexAtScreenAngle(
    impactRotation,
    participantCount,
    weights,
    impactPoint.impactAngleDegrees,
  );
  const winner = getRouletteSliceGeometry(participantCount, weights)[winnerIndex];
  if (!winner) return null;

  const span = winner.endAngle - winner.startAngle;
  const localAngle = normalizeAngle(impactPoint.impactAngleDegrees - impactRotation);
  const offsetFromStart = clamp(normalizeAngle(localAngle - winner.startAngle), 0, span);
  const positionRatio = span > 0 ? clamp(offsetFromStart / span, 0, 1) : 0.5;
  const distanceFromStart = offsetFromStart;
  const distanceFromEnd = Math.max(0, span - offsetFromStart);
  const threshold = Math.min(DART_BOUNDARY_MAX_DEGREES, span * 0.16);
  const nearStart = distanceFromStart <= threshold;
  const nearEnd = distanceFromEnd <= threshold;
  const kind: RouletteLandingKind = nearStart
    ? 'near-start'
    : nearEnd
      ? 'near-end'
      : 'interior';

  return {
    shot: {
      impactAngleDegrees: impactPoint.impactAngleDegrees,
      impactRadiusRatio: impactPoint.impactRadiusRatio,
      jitterA: { ...impactPoint.jitterA },
      jitterB: { ...impactPoint.jitterB },
      rollDegrees: impactPoint.rollDegrees,
    },
    impactRotation,
    flightDurationSeconds: safeDuration,
    geometrySignature: createRouletteGeometrySignature(participantCount, weights),
    winnerIndex,
    landing: {
      kind,
      positionRatio,
      entryGapDegrees: 12,
      leadDegrees: Math.min(distanceFromStart, distanceFromEnd),
      boundaryHit: kind !== 'interior',
    },
  };
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

type ResolvedLandingGeometry = {
  kind: RouletteLandingKind;
  boundarySide: RouletteBoundarySide | null;
  adjacentIndex: number | null;
  winnerDisplaySide: 'left' | 'right' | null;
  crossesBoundary: boolean;
  entryGapDegrees: number;
  boundaryDistanceDegrees: number;
  positionRatio: number;
  focusAngle: number;
  boundaryAngle: number;
  landingAngle: number;
};

function resolveLandingGeometry(
  winnerIndex: number,
  participantCount: number,
  weights: readonly number[] | undefined,
  landing: RouletteFinishLanding,
): ResolvedLandingGeometry | null {
  const slices = getRouletteSliceGeometry(participantCount, weights);
  const winner = slices[winnerIndex];
  if (!winner) return null;

  const winnerSpan = winner.endAngle - winner.startAngle;
  const legacyKind: RouletteLandingKind = landing.boundaryHit === false
    ? 'interior'
    : 'near-end';
  const kind = landing.kind ?? legacyKind;
  const hasExactRatio = Number.isFinite(landing.positionRatio);
  const requestedRatio = finiteClamped(
    landing.positionRatio ?? 0.5,
    0,
    1,
    0.5,
  );
  const requestedLead = finiteNonNegative(landing.leadDegrees, 12);
  const requestedProofClearance = finiteNonNegative(landing.minimumProofLeadDegrees ?? 0, 0);

  if (kind === 'interior') {
    const legacyRatio = winnerSpan > 0 ? 1 - requestedLead / winnerSpan : 0.5;
    const positionRatio = finiteClamped(
      hasExactRatio ? requestedRatio : legacyRatio,
      0.001,
      0.999,
      0.5,
    );
    const landingAngle = winner.startAngle + winnerSpan * positionRatio;
    const distanceFromStart = winnerSpan * positionRatio;
    const distanceFromEnd = winnerSpan - distanceFromStart;
    const boundarySide: RouletteBoundarySide = distanceFromStart <= distanceFromEnd
      ? 'start'
      : 'end';

    return {
      kind,
      boundarySide: null,
      adjacentIndex: null,
      winnerDisplaySide: null,
      crossesBoundary: false,
      entryGapDegrees: 0,
      boundaryDistanceDegrees: Math.min(distanceFromStart, distanceFromEnd),
      positionRatio,
      focusAngle: landingAngle,
      boundaryAngle: boundarySide === 'start' ? winner.startAngle : winner.endAngle,
      landingAngle,
    };
  }

  const boundarySide: RouletteBoundarySide = kind === 'near-start' ? 'start' : 'end';
  const ratioClearance = boundarySide === 'start'
    ? requestedRatio * winnerSpan
    : (1 - requestedRatio) * winnerSpan;
  const rawClearance = hasExactRatio ? ratioClearance : requestedLead;
  const minimumClearance = hasExactRatio
    ? 0
    : Math.min(0.1, winnerSpan * 0.1);
  const proofClearance = Math.min(requestedProofClearance, winnerSpan / 2);
  const boundaryDistanceDegrees = clamp(
    Math.max(rawClearance, proofClearance),
    minimumClearance,
    winnerSpan / 2,
  );
  const positionRatio = boundarySide === 'start'
    ? boundaryDistanceDegrees / winnerSpan
    : 1 - boundaryDistanceDegrees / winnerSpan;
  const requestedEntryGap = finiteNonNegative(landing.entryGapDegrees, 8);

  if (boundarySide === 'start') {
    const focusPadding = Math.min(2, winnerSpan * 0.12);
    const maximumFocusDistance = Math.max(boundaryDistanceDegrees, winnerSpan * 0.9);
    const minimumFocusDistance = Math.min(
      maximumFocusDistance,
      boundaryDistanceDegrees + focusPadding,
    );
    const entryGapDegrees = clamp(
      requestedEntryGap,
      minimumFocusDistance,
      maximumFocusDistance,
    );

    return {
      kind,
      boundarySide,
      adjacentIndex: (winnerIndex - 1 + participantCount) % participantCount,
      winnerDisplaySide: 'right',
      crossesBoundary: false,
      entryGapDegrees,
      boundaryDistanceDegrees,
      positionRatio,
      focusAngle: winner.startAngle + entryGapDegrees,
      boundaryAngle: winner.startAngle,
      landingAngle: winner.startAngle + boundaryDistanceDegrees,
    };
  }

  const nextSlice = slices[(winnerIndex + 1) % slices.length];
  const nextSpan = nextSlice.endAngle - nextSlice.startAngle;
  const minimumEntryGap = Math.min(0.1, nextSpan * 0.1);
  const entryGapDegrees = clamp(requestedEntryGap, minimumEntryGap, nextSpan * 0.9);

  return {
    kind,
    boundarySide,
    adjacentIndex: (winnerIndex + 1) % participantCount,
    winnerDisplaySide: 'left',
    crossesBoundary: true,
    entryGapDegrees,
    boundaryDistanceDegrees,
    positionRatio,
    focusAngle: winner.endAngle + entryGapDegrees,
    boundaryAngle: winner.endAngle,
    landingAngle: winner.endAngle - boundaryDistanceDegrees,
  };
}

/** Builds a monotonic clockwise finish for either edge or the slice interior. */
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
  const geometry = resolveLandingGeometry(winnerIndex, participantCount, weights, landing);

  if (!geometry) {
    return {
      focusRotation: safeCurrentRotation,
      boundaryRotation: safeCurrentRotation,
      finalRotation: safeCurrentRotation,
      entryGapDegrees: 0,
      leadDegrees: 0,
      focusAngle: 0,
      boundaryAngle: 0,
      landingAngle: 0,
      landingKind: 'interior',
      boundarySide: null,
      adjacentIndex: null,
      winnerDisplaySide: null,
      crossesBoundary: false,
      boundaryDistanceDegrees: 0,
      positionRatio: 0.5,
    };
  }

  const focusTarget = normalizeAngle(presentationAngle - geometry.focusAngle);
  const currentAngle = normalizeAngle(safeCurrentRotation);
  const alignmentDelta = normalizeAngle(focusTarget - currentAngle);
  const safeTurns = finiteNonNegative(fullTurns, 0);
  const focusRotation = safeCurrentRotation + safeTurns * 360 + alignmentDelta;
  const finalRotation = geometry.kind === 'interior'
    ? focusRotation
    : geometry.boundarySide === 'start'
      ? focusRotation + geometry.focusAngle - geometry.landingAngle
      : focusRotation + geometry.entryGapDegrees + geometry.boundaryDistanceDegrees;
  const boundaryRotation = geometry.kind === 'interior'
    ? finalRotation
    : geometry.boundarySide === 'start'
      ? finalRotation + geometry.boundaryDistanceDegrees
      : focusRotation + geometry.entryGapDegrees;

  return {
    focusRotation,
    boundaryRotation,
    finalRotation,
    entryGapDegrees: geometry.entryGapDegrees,
    leadDegrees: geometry.boundaryDistanceDegrees,
    focusAngle: geometry.focusAngle,
    boundaryAngle: geometry.boundaryAngle,
    landingAngle: geometry.landingAngle,
    landingKind: geometry.kind,
    boundarySide: geometry.boundarySide,
    adjacentIndex: geometry.adjacentIndex,
    winnerDisplaySide: geometry.winnerDisplaySide,
    crossesBoundary: geometry.crossesBoundary,
    boundaryDistanceDegrees: geometry.boundaryDistanceDegrees,
    positionRatio: geometry.positionRatio,
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

/**
 * Continues from an already committed physical impact. Unlike the legacy
 * preview helper above, this never rotates a selected winner into the shot;
 * the impact rotation itself was what selected the winner.
 */
export function buildCommittedDartRouletteFinishPlan(
  commit: DartPhysicalCommit,
  participantCount: number,
  coastTurns: number,
  weights?: readonly number[],
  minimumImpactRotation = commit.impactRotation,
): DartRouletteFinishPlan {
  const impactPoint = resolveDartImpactPoint(commit.shot);
  const geometry = resolveLandingGeometry(
    commit.winnerIndex,
    participantCount,
    weights,
    commit.landing,
  );
  const safeCoastTurns = Math.max(1, Math.floor(finiteNonNegative(coastTurns, 1)));
  const safeMinimumImpact = Number.isFinite(minimumImpactRotation)
    ? minimumImpactRotation
    : commit.impactRotation;
  const catchUpTurns = Math.max(
    0,
    Math.ceil((safeMinimumImpact - commit.impactRotation) / 360),
  );
  // A delayed React paint may happen after the originally committed impact
  // angle. Whole turns preserve the exact local wedge and result while making
  // the contact a future, clockwise event instead of reversing the rotor.
  const impactRotation = commit.impactRotation + catchUpTurns * 360;
  const alignmentToPointer = normalizeAngle(AUTO_POINTER_ANGLE - impactPoint.impactAngleDegrees);
  const finalRotation = impactRotation + safeCoastTurns * 360 + alignmentToPointer;

  if (!geometry) {
    return {
      focusRotation: impactRotation,
      boundaryRotation: impactRotation,
      finalRotation,
      entryGapDegrees: 0,
      leadDegrees: 0,
      focusAngle: 0,
      boundaryAngle: 0,
      landingAngle: 0,
      landingKind: 'interior',
      boundarySide: null,
      adjacentIndex: null,
      winnerDisplaySide: null,
      crossesBoundary: false,
      boundaryDistanceDegrees: 0,
      positionRatio: 0.5,
      impactRotation,
      coastTurns: safeCoastTurns,
      impactAngleDegrees: impactPoint.impactAngleDegrees,
      impactRadiusRatio: impactPoint.impactRadiusRatio,
    };
  }

  return {
    focusRotation: impactRotation,
    boundaryRotation: impactRotation,
    finalRotation,
    entryGapDegrees: geometry.entryGapDegrees,
    leadDegrees: geometry.boundaryDistanceDegrees,
    focusAngle: geometry.landingAngle,
    boundaryAngle: geometry.boundaryAngle,
    landingAngle: geometry.landingAngle,
    landingKind: geometry.kind,
    boundarySide: geometry.boundarySide,
    adjacentIndex: geometry.adjacentIndex,
    winnerDisplaySide: geometry.winnerDisplaySide,
    crossesBoundary: false,
    boundaryDistanceDegrees: geometry.boundaryDistanceDegrees,
    positionRatio: geometry.positionRatio,
    impactRotation,
    coastTurns: safeCoastTurns,
    impactAngleDegrees: impactPoint.impactAngleDegrees,
    impactRadiusRatio: impactPoint.impactRadiusRatio,
  };
}
