import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, TransitionEvent } from 'react';

import DartFinish, { BoundaryNames, EmbeddedDart } from './DartFinish';
import {
  buildDartRouletteFinishPlan,
  buildRouletteFinishPlan,
  calculateAutoPhotoFinishTiming,
  calculateDartFlightTiming,
  calculateDartPostImpactDuration,
  DART_FLIGHT_DURATION_SECONDS,
  getRouletteSliceGeometry,
  isRoulettePhotoFinish,
  type DartRouletteFinishPlan,
  type RouletteFinishLanding,
  type RouletteFinishPlan,
} from '../lib/roulette';
import type { WheelPresentation } from '../types';
import './RouletteWheel.css';

export interface RouletteWheelProps {
  participants: string[];
  /** Optional positive draw weights; omitted keeps every visible slice equal. */
  weights?: readonly number[];
  itemType?: 'participant' | 'prize';
  winnerIndex: number | null;
  spinning: boolean;
  /** Live wheel stages accelerate immediately and cruise before the host acts. */
  idleSpinning?: boolean;
  spinKey: number;
  /** App-level presentation id; defaults to spinKey for backwards compatibility. */
  revealId?: number;
  /** Changes only the on-air reveal; the winner is selected outside this component. */
  presentation?: WheelPresentation;
  /** Visual-only finish placement, generated after the winner is committed. */
  landing?: RouletteFinishLanding;
  /** Physical reveal beats used by the camera, sound, lighting and status UI. */
  onRevealPhase?: (event: RouletteRevealEvent) => void;
  /** Enables the host action only after the live rotor reaches cruise speed. */
  onIdleCruise?: () => void;
  onSpinEnd: () => void;
}

export type RouletteRevealPhase =
  | 'boundary-entered'
  | 'boundary-crossed'
  | 'dart-launched'
  | 'dart-impacted'
  | 'dart-attached'
  | 'rotation-stopped'
  | 'proof-hold-done';

export interface RouletteRevealMetadata {
  presentation: WheelPresentation;
  winnerIndex: number | null;
  participantCount: number;
  boundaryHit?: boolean;
  candidateBefore?: string;
  candidateAfter?: string;
}

export interface RouletteRevealEvent {
  /** One reveal is one committed spin. App should discard older ids. */
  revealId: number;
  spinKey: number;
  phase: RouletteRevealPhase;
  at: number;
  metadata: RouletteRevealMetadata;
}

const WHEEL_COLORS = [
  'var(--hot-pink, #ffb6c1)',
  'var(--lemon, #ffd166)',
  'var(--mint, #34e0a8)',
  'var(--sky, #4ea9f0)',
  'var(--lavender, #7e57c2)',
  'var(--orange, #ff9d54)',
];

const VIEWBOX_CENTER = 300;
const WHEEL_RADIUS = 258;
const DART_IMPACT_HIGHLIGHT_DELAY = 440;
const STOP_HOLD_DELAY = 950;
const IDLE_SPIN_ACCELERATION_MS = 900;
const IDLE_SPIN_DEGREES_PER_SECOND = 780;
const AUTO_WHIRL_FULL_TURNS = 4;
const DART_ATTACHED_PROOF_SECONDS = 0.28;
const DART_ATTACHED_COAST_TURNS = 2;

type SpinPhase =
  | 'idle'
  | 'auto-brake'
  | 'auto-photo-finish'
  | 'dart-flight'
  | 'dart-impact-contact'
  | 'dart-attached-proof'
  | 'dart-after-impact'
  | 'stop-hold';

type IdleMotionPhase = 'stopped' | 'spin-up' | 'cruise';
type BoundaryVisualPhase = 'idle' | 'approach' | 'crossed';

type RouletteStyle = CSSProperties & {
  '--wheel-rotation': string;
  '--slice-count': number;
  '--wheel-auto-whirl-duration': string;
  '--wheel-auto-brake-ease': string;
  '--wheel-photo-finish-duration': string;
  '--wheel-dart-flight-duration': string;
  '--wheel-dart-attached-duration': string;
  '--wheel-post-impact-duration': string;
};

function polarPoint(angleInDegrees: number, radius = WHEEL_RADIUS) {
  const angleInRadians = (angleInDegrees * Math.PI) / 180;

  return {
    x: Math.cos(angleInRadians) * radius,
    y: Math.sin(angleInRadians) * radius,
  };
}

function makeSlicePath(startAngle: number, endAngle: number) {
  const sliceAngle = endAngle - startAngle;

  if (sliceAngle >= 359.999) {
    return `M 0 -${WHEEL_RADIUS} A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 1 1 0 ${WHEEL_RADIUS} A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 1 1 0 -${WHEEL_RADIUS}`;
  }

  if (sliceAngle <= 0.001) return null;

  const start = polarPoint(startAngle);
  const end = polarPoint(endAngle);
  const largeArc = sliceAngle > 180 ? 1 : 0;

  return [
    'M 0 0',
    `L ${start.x.toFixed(3)} ${start.y.toFixed(3)}`,
    `A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`,
    'Z',
  ].join(' ');
}

function compactName(name: string, count: number) {
  const normalized = name.trim() || '이름 없음';
  const limit = count <= 10 ? 11 : count <= 18 ? 8 : count <= 28 ? 5 : 3;

  return normalized.length > limit
    ? `${normalized.slice(0, Math.max(1, limit - 1))}…`
    : normalized;
}

export default function RouletteWheel({
  participants,
  weights,
  itemType = 'participant',
  winnerIndex,
  spinning,
  idleSpinning = false,
  spinKey,
  revealId,
  presentation = 'spin',
  landing,
  onRevealPhase,
  onIdleCruise,
  onSpinEnd,
}: RouletteWheelProps) {
  const [rotation, setRotation] = useState(0);
  const [autoWhirlDuration, setAutoWhirlDuration] = useState(4.2);
  const [autoBrakeEase, setAutoBrakeEase] = useState('cubic-bezier(0.3333, 0.6667, 0.6667, 1)');
  const [autoPhotoFinishDuration, setAutoPhotoFinishDuration] = useState(1.55);
  const [dartFlightDuration, setDartFlightDuration] = useState(DART_FLIGHT_DURATION_SECONDS);
  const [postImpactDuration, setPostImpactDuration] = useState(1.55);
  const [isAnimating, setIsAnimating] = useState(false);
  const [spinPhase, setSpinPhase] = useState<SpinPhase>('idle');
  const [boundaryVisualPhase, setBoundaryVisualPhase] = useState<BoundaryVisualPhase>('idle');
  const [idleMotionPhase, setIdleMotionPhase] = useState<IdleMotionPhase>('stopped');
  const [dartPhase, setDartPhase] = useState<'idle' | 'launch' | 'approach' | 'impact' | 'coast' | 'settled'>('idle');
  const [dartImpactRotation, setDartImpactRotation] = useState(0);
  const [landingBoundaryHit, setLandingBoundaryHit] = useState(false);
  const lastSpinKey = useRef<number | null>(null);
  const completedSpinKey = useRef<number | null>(null);
  const completionFallbackTimer = useRef<number | null>(null);
  const stopHoldTimer = useRef<number | null>(null);
  const dartApproachTimer = useRef<number | null>(null);
  const dartImpactTimer = useRef<number | null>(null);
  const boundaryEnteredTimer = useRef<number | null>(null);
  const boundaryCrossedTimer = useRef<number | null>(null);
  const dartIdleFrame = useRef<number | null>(null);
  const dartAttachFrame = useRef<number | null>(null);
  const onSpinEndRef = useRef(onSpinEnd);
  const onRevealPhaseRef = useRef(onRevealPhase);
  const onIdleCruiseRef = useRef(onIdleCruise);
  const discRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef(0);
  const activeRevealIdRef = useRef(revealId ?? spinKey);
  const idleAngularVelocityRef = useRef(0);
  const dartAttachedRotationRef = useRef(0);
  const finishPlanRef = useRef<RouletteFinishPlan | DartRouletteFinishPlan | null>(null);
  const emittedRevealPhasesRef = useRef<Set<RouletteRevealPhase>>(new Set());
  const revealMetadataRef = useRef<RouletteRevealMetadata>({
    presentation,
    winnerIndex: null,
    participantCount: 0,
  });
  const participantCount = participants.length;
  const isPrizeDraw = itemType === 'prize';
  const itemNoun = isPrizeDraw ? '상품' : '참가자';
  const countUnit = isPrizeDraw ? '개' : '명';
  const isDartPresentation = presentation === 'dart';
  const validWinner =
    winnerIndex !== null && winnerIndex >= 0 && winnerIndex < participantCount;

  const sliceGeometry = useMemo(
    () => getRouletteSliceGeometry(participantCount, weights),
    [participantCount, weights],
  );

  useEffect(() => {
    onSpinEndRef.current = onSpinEnd;
  }, [onSpinEnd]);

  useEffect(() => {
    onRevealPhaseRef.current = onRevealPhase;
  }, [onRevealPhase]);

  useEffect(() => {
    onIdleCruiseRef.current = onIdleCruise;
  }, [onIdleCruise]);

  const emitRevealPhase = useCallback((phase: RouletteRevealPhase, revealKey: number) => {
    if (lastSpinKey.current !== revealKey || emittedRevealPhasesRef.current.has(phase)) return;

    emittedRevealPhasesRef.current.add(phase);
    onRevealPhaseRef.current?.({
      revealId: activeRevealIdRef.current,
      spinKey: revealKey,
      phase,
      at: typeof performance === 'undefined' ? Date.now() : performance.now(),
      metadata: { ...revealMetadataRef.current },
    });
  }, []);

  const settleSpin = useCallback((completedKey: number) => {
    if (completedSpinKey.current === completedKey) return;

    emitRevealPhase('proof-hold-done', completedKey);
    completedSpinKey.current = completedKey;
    if (completionFallbackTimer.current !== null) {
      window.clearTimeout(completionFallbackTimer.current);
      completionFallbackTimer.current = null;
    }
    if (stopHoldTimer.current !== null) {
      window.clearTimeout(stopHoldTimer.current);
      stopHoldTimer.current = null;
    }
    if (dartApproachTimer.current !== null) {
      window.clearTimeout(dartApproachTimer.current);
      dartApproachTimer.current = null;
    }
    if (dartImpactTimer.current !== null) {
      window.clearTimeout(dartImpactTimer.current);
      dartImpactTimer.current = null;
    }
    if (boundaryEnteredTimer.current !== null) {
      window.clearTimeout(boundaryEnteredTimer.current);
      boundaryEnteredTimer.current = null;
    }
    if (boundaryCrossedTimer.current !== null) {
      window.clearTimeout(boundaryCrossedTimer.current);
      boundaryCrossedTimer.current = null;
    }
    if (dartAttachFrame.current !== null) {
      window.cancelAnimationFrame(dartAttachFrame.current);
      dartAttachFrame.current = null;
    }
    setIsAnimating(false);
    setSpinPhase('idle');
    setBoundaryVisualPhase('idle');
    finishPlanRef.current = null;
    onSpinEndRef.current();
  }, [emitRevealPhase]);

  const beginProofHold = useCallback((revealKey: number, dartReveal: boolean) => {
    if (
      lastSpinKey.current !== revealKey ||
      completedSpinKey.current === revealKey ||
      stopHoldTimer.current !== null
    ) {
      return;
    }

    if (boundaryEnteredTimer.current !== null) {
      window.clearTimeout(boundaryEnteredTimer.current);
      boundaryEnteredTimer.current = null;
    }
    if (boundaryCrossedTimer.current !== null) {
      window.clearTimeout(boundaryCrossedTimer.current);
      boundaryCrossedTimer.current = null;
    }
    if (dartReveal) setDartPhase('settled');
    setSpinPhase('stop-hold');
    emitRevealPhase('rotation-stopped', revealKey);
    stopHoldTimer.current = window.setTimeout(() => {
      stopHoldTimer.current = null;
      settleSpin(revealKey);
    }, STOP_HOLD_DELAY);
  }, [emitRevealPhase, settleSpin]);

  useEffect(() => () => {
    if (completionFallbackTimer.current !== null) {
      window.clearTimeout(completionFallbackTimer.current);
    }
    if (stopHoldTimer.current !== null) window.clearTimeout(stopHoldTimer.current);
    if (dartApproachTimer.current !== null) window.clearTimeout(dartApproachTimer.current);
    if (dartImpactTimer.current !== null) window.clearTimeout(dartImpactTimer.current);
    if (boundaryEnteredTimer.current !== null) window.clearTimeout(boundaryEnteredTimer.current);
    if (boundaryCrossedTimer.current !== null) window.clearTimeout(boundaryCrossedTimer.current);
    if (dartIdleFrame.current !== null) window.cancelAnimationFrame(dartIdleFrame.current);
    if (dartAttachFrame.current !== null) window.cancelAnimationFrame(dartAttachFrame.current);
  }, []);

  useEffect(() => {
    if (spinning || completionFallbackTimer.current === null) return;
    window.clearTimeout(completionFallbackTimer.current);
    completionFallbackTimer.current = null;
  }, [spinning]);

  useEffect(() => {
    const shouldIdleSpin = idleSpinning && participantCount > 0 && !spinning && !validWinner;
    if (!shouldIdleSpin) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      idleAngularVelocityRef.current = IDLE_SPIN_DEGREES_PER_SECOND;
      setIdleMotionPhase('cruise');
      onIdleCruiseRef.current?.();
      return undefined;
    }

    let previousTime: number | null = null;
    let startedAt: number | null = null;
    let cruising = false;
    setIdleMotionPhase('spin-up');
    const tick = (time: number) => {
      if (startedAt === null) startedAt = time;
      if (previousTime !== null) {
        const elapsedSeconds = Math.min(64, time - previousTime) / 1_000;
        const accelerationProgress = Math.min(1, (time - startedAt) / IDLE_SPIN_ACCELERATION_MS);
        const easedAcceleration = 1 - ((1 - accelerationProgress) ** 3);
        if (accelerationProgress >= 1 && !cruising) {
          cruising = true;
          setIdleMotionPhase('cruise');
          onIdleCruiseRef.current?.();
        }
        const angularVelocity = IDLE_SPIN_DEGREES_PER_SECOND * easedAcceleration;
        idleAngularVelocityRef.current = angularVelocity;
        rotationRef.current += elapsedSeconds * angularVelocity;
        if (rotationRef.current > 360_000) rotationRef.current %= 360;
        discRef.current?.style.setProperty('--wheel-rotation', `${rotationRef.current}deg`);
      }
      previousTime = time;
      dartIdleFrame.current = window.requestAnimationFrame(tick);
    };

    setDartPhase('idle');
    dartIdleFrame.current = window.requestAnimationFrame(tick);
    return () => {
      if (dartIdleFrame.current !== null) {
        window.cancelAnimationFrame(dartIdleFrame.current);
        dartIdleFrame.current = null;
      }
    };
  }, [idleSpinning, isDartPresentation, participantCount, spinning, validWinner]);

  const slices = useMemo(() => {
    if (participantCount === 0) return [];

    return sliceGeometry.map((geometry, index) => {
      const participant = participants[index];
      const sliceAngle = geometry.endAngle - geometry.startAngle;
      const middleAngle = geometry.centreAngle;
      const baseLabelRadius = participantCount > 28 ? 205 : participantCount > 16 ? 195 : 178;
      const labelRadius = sliceAngle < 16 ? Math.min(WHEEL_RADIUS - 20, baseLabelRadius + 35) : baseLabelRadius;
      const labelPoint = polarPoint(middleAngle, labelRadius);
      const normalizedMiddle = ((middleAngle % 360) + 360) % 360;
      const labelRotation =
        normalizedMiddle > 90 && normalizedMiddle < 270
          ? middleAngle + 180
          : middleAngle;

      return {
        participant,
        index,
        path: makeSlicePath(geometry.startAngle, geometry.endAngle),
        color: WHEEL_COLORS[index % WHEEL_COLORS.length],
        label: compactName(participant, participantCount),
        showLabel: sliceAngle > 1,
        labelTransform: `translate(${labelPoint.x.toFixed(2)} ${labelPoint.y.toFixed(2)}) rotate(${labelRotation.toFixed(2)})`,
      };
    });
  }, [participantCount, participants, sliceGeometry]);

  useEffect(() => {
    if (
      !spinning ||
      participantCount === 0 ||
      winnerIndex === null ||
      winnerIndex < 0 ||
      winnerIndex >= participantCount ||
      lastSpinKey.current === spinKey
    ) {
      return;
    }

    lastSpinKey.current = spinKey;
    completedSpinKey.current = null;
    emittedRevealPhasesRef.current = new Set();
    setBoundaryVisualPhase('idle');
    setIsAnimating(true);

    const startingRotation = rotationRef.current;
    activeRevealIdRef.current = revealId ?? spinKey;
    const candidateBeforeIndex = (winnerIndex + 1) % participantCount;

    let plannedAutoWhirlDuration = 4.2;
    let plannedPhotoFinishDuration = 0;
    let plannedDartFlightDuration = DART_FLIGHT_DURATION_SECONDS;
    let plannedPostImpactDuration = 1.55;
    let actualBoundaryHit = false;
    let finishPlan: RouletteFinishPlan | DartRouletteFinishPlan;

    if (isDartPresentation) {
      const basePlan = buildDartRouletteFinishPlan(
        startingRotation,
        winnerIndex,
        participantCount,
        0,
        DART_ATTACHED_COAST_TURNS,
        weights,
        landing,
      );
      const cruiseVelocity = idleAngularVelocityRef.current > 1
        ? idleAngularVelocityRef.current
        : IDLE_SPIN_DEGREES_PER_SECOND;
      const flightTiming = calculateDartFlightTiming(
        basePlan.impactRotation - startingRotation,
        cruiseVelocity,
      );
      const dartPlan = buildDartRouletteFinishPlan(
        startingRotation,
        winnerIndex,
        participantCount,
        flightTiming.fullTurns,
        DART_ATTACHED_COAST_TURNS,
        weights,
        landing,
      );
      finishPlan = dartPlan;
      actualBoundaryHit = isRoulettePhotoFinish(landing?.boundaryHit, participantCount, dartPlan);

      const flightDistance = Math.max(1, dartPlan.impactRotation - startingRotation);
      plannedDartFlightDuration = flightDistance / flightTiming.angularVelocity;
      const coastDistance = dartPlan.finalRotation - dartPlan.impactRotation;
      const attachedTravel = Math.min(
        coastDistance * 0.42,
        flightTiming.angularVelocity * DART_ATTACHED_PROOF_SECONDS,
      );
      dartAttachedRotationRef.current = dartPlan.impactRotation + attachedTravel;
      const brakeDistance = dartPlan.finalRotation - dartAttachedRotationRef.current;
      // The CSS curve is p(t)=2t-t²: it begins at exactly 2× average speed and
      // decreases continuously to zero. This duration therefore matches the
      // incoming linear velocity without any post-impact acceleration.
      plannedPostImpactDuration = calculateDartPostImpactDuration(
        flightDistance,
        brakeDistance,
        plannedDartFlightDuration,
      );
      setDartFlightDuration(plannedDartFlightDuration);
      setPostImpactDuration(plannedPostImpactDuration);
      setDartImpactRotation(dartPlan.impactRotation);
    } else {
      finishPlan = buildRouletteFinishPlan(
        startingRotation,
        winnerIndex,
        participantCount,
        AUTO_WHIRL_FULL_TURNS,
        weights,
        landing,
      );
      actualBoundaryHit = isRoulettePhotoFinish(landing?.boundaryHit, participantCount, finishPlan);
      const startingVelocity = idleAngularVelocityRef.current > 1
        ? idleAngularVelocityRef.current
        : IDLE_SPIN_DEGREES_PER_SECOND;

      if (actualBoundaryHit) {
        const timing = calculateAutoPhotoFinishTiming(startingRotation, finishPlan, startingVelocity);
        plannedAutoWhirlDuration = timing.brakeDuration;
        plannedPhotoFinishDuration = timing.photoFinishDuration;
        setAutoBrakeEase(timing.brakeBezier);
        setAutoPhotoFinishDuration(plannedPhotoFinishDuration);
      } else {
        const decelerationDistance = Math.max(1, finishPlan.finalRotation - startingRotation);
        plannedAutoWhirlDuration = Math.max(
          3.2,
          Math.min(5.2, (2 * decelerationDistance) / startingVelocity),
        );
        setAutoBrakeEase('cubic-bezier(0.3333, 0.6667, 0.6667, 1)');
      }

      setAutoWhirlDuration(plannedAutoWhirlDuration);
    }
    setLandingBoundaryHit(actualBoundaryHit);
    revealMetadataRef.current = {
      presentation,
      winnerIndex,
      participantCount,
      boundaryHit: actualBoundaryHit,
      candidateBefore: participants[candidateBeforeIndex],
      candidateAfter: participants[winnerIndex],
    };
    finishPlanRef.current = finishPlan;

    if (completionFallbackTimer.current !== null) {
      window.clearTimeout(completionFallbackTimer.current);
    }

    const fallbackDelay = isDartPresentation
      ? Math.ceil((
          plannedDartFlightDuration +
          DART_ATTACHED_PROOF_SECONDS +
          plannedPostImpactDuration +
          STOP_HOLD_DELAY / 1_000 +
          0.8
        ) * 1_000)
      : Math.ceil((
          plannedAutoWhirlDuration
          + plannedPhotoFinishDuration
          + STOP_HOLD_DELAY / 1_000
          + 0.8
        ) * 1_000);
    completionFallbackTimer.current = window.setTimeout(() => {
      if (lastSpinKey.current !== spinKey || completedSpinKey.current === spinKey) return;

      const activePlan = finishPlanRef.current;
      if (!activePlan) return;
      rotationRef.current = activePlan.finalRotation;
      setRotation(activePlan.finalRotation);
      if (isDartPresentation) {
        emitRevealPhase('dart-impacted', spinKey);
        emitRevealPhase('dart-attached', spinKey);
      } else if (actualBoundaryHit) {
        setBoundaryVisualPhase('crossed');
        emitRevealPhase('boundary-entered', spinKey);
        emitRevealPhase('boundary-crossed', spinKey);
      }
      beginProofHold(spinKey, isDartPresentation);
    }, fallbackDelay);

    if (isDartPresentation) {
      setDartPhase('launch');
      emitRevealPhase('dart-launched', spinKey);
      dartApproachTimer.current = window.setTimeout(() => {
        if (lastSpinKey.current === spinKey && completedSpinKey.current !== spinKey) {
          setDartPhase('approach');
        }
      }, plannedDartFlightDuration * 0.37 * 1_000);
      rotationRef.current = finishPlan.boundaryRotation;
      setSpinPhase('dart-flight');
      setRotation(finishPlan.boundaryRotation);
      return;
    }

    const firstAutoTarget = actualBoundaryHit ? finishPlan.focusRotation : finishPlan.finalRotation;
    rotationRef.current = firstAutoTarget;
    setSpinPhase('auto-brake');
    setRotation(firstAutoTarget);
  }, [
    beginProofHold,
    emitRevealPhase,
    isDartPresentation,
    landing,
    participantCount,
    participants,
    presentation,
    revealId,
    spinKey,
    spinning,
    weights,
    winnerIndex,
  ]);

  useEffect(() => {
    if (!isDartPresentation) setDartPhase('idle');
    else if (!spinning && validWinner) setDartPhase('settled');
  }, [isDartPresentation, spinning, validWinner]);

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (
      event.target !== event.currentTarget ||
      event.propertyName !== 'transform' ||
      !isAnimating
    ) {
      return;
    }

    const finishPlan = finishPlanRef.current;
    if (!finishPlan) return;

    if (spinPhase === 'dart-flight') {
      if (!('impactRotation' in finishPlan)) return;
      rotationRef.current = finishPlan.impactRotation;
      setDartPhase('impact');
      emitRevealPhase('dart-impacted', spinKey);
      if (dartImpactTimer.current !== null) window.clearTimeout(dartImpactTimer.current);
      // Impact only answers "did it hit the boundary?". The winner stays
      // hidden while the board coasts, then becomes clear at the final stop.
      dartImpactTimer.current = window.setTimeout(() => {
        if (lastSpinKey.current !== spinKey || completedSpinKey.current === spinKey) return;
        dartImpactTimer.current = null;
        setDartPhase('coast');
      }, DART_IMPACT_HIGHLIGHT_DELAY);
      // Paint the exact contact frame before the board carries the dart away.
      // Two requestAnimationFrame boundaries provide a short hit-stop while
      // keeping the pre-impact rotor at full speed and the embedded dart in
      // the same wheel-local coordinate for every following frame.
      setSpinPhase('dart-impact-contact');
      setRotation(finishPlan.impactRotation);
      dartAttachFrame.current = window.requestAnimationFrame(() => {
        dartAttachFrame.current = window.requestAnimationFrame(() => {
          dartAttachFrame.current = null;
          if (lastSpinKey.current !== spinKey || completedSpinKey.current === spinKey) return;
          rotationRef.current = dartAttachedRotationRef.current;
          setSpinPhase('dart-attached-proof');
          setRotation(dartAttachedRotationRef.current);
          emitRevealPhase('dart-attached', spinKey);
        });
      });
      return;
    }

    if (spinPhase === 'dart-attached-proof') {
      rotationRef.current = finishPlan.finalRotation;
      setSpinPhase('dart-after-impact');
      setRotation(finishPlan.finalRotation);
      return;
    }

    if (spinPhase === 'dart-after-impact') {
      if (dartImpactTimer.current !== null) {
        window.clearTimeout(dartImpactTimer.current);
        dartImpactTimer.current = null;
      }
      beginProofHold(spinKey, true);
      return;
    }

    if (spinPhase === 'auto-brake') {
      if (!landingBoundaryHit) {
        beginProofHold(spinKey, false);
        return;
      }

      setBoundaryVisualPhase('approach');
      emitRevealPhase('boundary-entered', spinKey);
      const photoFinishDistance = Math.max(0.1, finishPlan.finalRotation - finishPlan.focusRotation);
      const boundaryProgress = Math.min(
        1,
        Math.max(0, (finishPlan.boundaryRotation - finishPlan.focusRotation) / photoFinishDistance),
      );
      const crossedDelay = autoPhotoFinishDuration
        * (1 - Math.sqrt(1 - boundaryProgress))
        * 1_000;
      boundaryCrossedTimer.current = window.setTimeout(() => {
        if (lastSpinKey.current !== spinKey || completedSpinKey.current === spinKey) return;
        boundaryCrossedTimer.current = null;
        setBoundaryVisualPhase('crossed');
        emitRevealPhase('boundary-crossed', spinKey);
      }, crossedDelay);
      rotationRef.current = finishPlan.finalRotation;
      setSpinPhase('auto-photo-finish');
      setRotation(finishPlan.finalRotation);
      return;
    }

    if (spinPhase === 'auto-photo-finish') {
      if (boundaryCrossedTimer.current !== null) {
        window.clearTimeout(boundaryCrossedTimer.current);
        boundaryCrossedTimer.current = null;
      }
      setBoundaryVisualPhase('crossed');
      emitRevealPhase('boundary-crossed', spinKey);
      beginProofHold(spinKey, false);
    }
  };

  const visuallySpinning = spinning && isAnimating;
  const showWinner = validWinner && !spinning && !visuallySpinning;
  const isBoundaryFocus = boundaryVisualPhase !== 'idle';
  const isDartReady = isDartPresentation && participantCount > 0 && !spinning && !validWinner;
  const isIdleSpinning = idleSpinning && participantCount > 0 && !spinning && !validWinner;
  const motionPhase = isIdleSpinning
    ? idleMotionPhase
    : boundaryVisualPhase === 'approach'
      ? 'boundary-approach'
      : boundaryVisualPhase === 'crossed'
        ? 'boundary-creep'
        : spinPhase;
  const boundaryBeforeIndex = validWinner ? (winnerIndex + 1) % participantCount : -1;
  const boundaryAfterIndex = validWinner ? winnerIndex : -1;
  const showBoundaryNames = participantCount > 1 && validWinner && (
    (!isDartPresentation && landingBoundaryHit && isBoundaryFocus) ||
    (isDartPresentation && landingBoundaryHit && dartPhase === 'impact')
  );
  const rootClassName = [
    'roulette-wheel',
    visuallySpinning ? 'is-spinning' : '',
    isDartPresentation ? 'is-dart' : '',
    isDartReady ? 'is-dart-ready' : '',
    isIdleSpinning ? 'is-idle-spinning' : '',
    isIdleSpinning && idleMotionPhase === 'spin-up' ? 'is-spin-up' : '',
    isIdleSpinning && idleMotionPhase === 'cruise' ? 'is-cruising' : '',
    spinPhase === 'auto-brake' ? 'is-auto-brake' : '',
    spinPhase === 'auto-photo-finish' ? 'is-auto-photo-finish' : '',
    spinPhase === 'dart-flight' ? 'is-dart-flight' : '',
    spinPhase === 'dart-impact-contact' ? 'is-dart-impact-contact' : '',
    spinPhase === 'dart-attached-proof' ? 'is-dart-attached-proof' : '',
    spinPhase === 'dart-after-impact' ? 'is-dart-after-impact' : '',
    isBoundaryFocus ? 'is-boundary-focus' : '',
    boundaryVisualPhase === 'approach' ? 'is-boundary-approach' : '',
    boundaryVisualPhase === 'crossed' ? 'is-boundary-creep' : '',
    spinPhase === 'stop-hold' ? 'is-stop-hold' : '',
    showWinner ? 'has-result' : '',
    participantCount === 0 ? 'is-empty' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const wheelStyle: RouletteStyle = {
    '--wheel-rotation': `${rotation}deg`,
    '--slice-count': Math.max(1, participantCount),
    '--wheel-auto-whirl-duration': `${autoWhirlDuration}s`,
    '--wheel-auto-brake-ease': autoBrakeEase,
    '--wheel-photo-finish-duration': `${autoPhotoFinishDuration}s`,
    '--wheel-dart-flight-duration': `${dartFlightDuration}s`,
    '--wheel-dart-attached-duration': `${DART_ATTACHED_PROOF_SECONDS}s`,
    '--wheel-post-impact-duration': `${postImpactDuration}s`,
  };

  return (
    <section
      className={rootClassName}
      data-spin-phase={spinPhase}
      data-motion-phase={motionPhase}
      aria-label="Retto Roulette 추첨 룰렛"
    >
      <div className="roulette-wheel__stage">
        <span className="roulette-wheel__spark roulette-wheel__spark--one" aria-hidden="true">✦</span>
        <span className="roulette-wheel__spark roulette-wheel__spark--two" aria-hidden="true">●</span>
        <span className="roulette-wheel__spark roulette-wheel__spark--three" aria-hidden="true">★</span>

        <div className="roulette-wheel__pointer" aria-hidden="true">
          <span className="roulette-wheel__pointer-pin" />
        </div>

        <div className="roulette-wheel__rim">
          <div
            ref={discRef}
            className="roulette-wheel__disc"
            style={wheelStyle}
            onTransitionEnd={handleTransitionEnd}
          >
            <svg
              viewBox="0 0 600 600"
              role="img"
              aria-label={
                participantCount > 0
                  ? `${participantCount}${countUnit}의 ${itemNoun} 룰렛`
                  : `${itemNoun}을 기다리는 빈 룰렛`
              }
            >
              <title>
                {participantCount > 0
                  ? `Retto Roulette, ${itemNoun} ${participantCount}${countUnit}`
                  : '명단을 준비하면 룰렛이 완성됩니다.'}
              </title>

              <g transform={`translate(${VIEWBOX_CENTER} ${VIEWBOX_CENTER})`}>
                {slices.map((slice) => (
                  <g key={`${slice.index}-${slice.participant}`}>
                    {slice.path && (
                      <path
                        className={`roulette-wheel__slice${
                          showWinner && slice.index === winnerIndex
                            ? ' roulette-wheel__slice--winner'
                            : ''
                        }`}
                        d={slice.path}
                        fill={slice.color}
                      />
                    )}
                    {slice.showLabel && (
                      <text
                        className="roulette-wheel__label"
                        style={{
                          fontSize: `${Math.max(10, Math.min(20, 170 / participantCount))}px`,
                        }}
                        transform={slice.labelTransform}
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {slice.label}
                        <title>{slice.participant}</title>
                      </text>
                    )}
                  </g>
                ))}

                {participantCount === 0 && (
                  <g className="roulette-wheel__empty-copy">
                    <text y="4" textAnchor="middle">{itemNoun} 없음</text>
                  </g>
                )}
              </g>
            </svg>

            {isDartPresentation && (
              <EmbeddedDart
                phase={dartPhase}
                impactRotation={dartImpactRotation}
                boundaryHit={landingBoundaryHit}
              />
            )}

            <div className="roulette-wheel__hub" aria-hidden="true">
              <span>RETTO</span>
              <small>ROULETTE</small>
            </div>
          </div>

          {isDartPresentation && (
            <DartFinish
              phase={dartPhase}
              boundaryHit={landingBoundaryHit}
              flightDurationSeconds={dartFlightDuration}
            />
          )}

          {validWinner && participantCount > 1 && (
            <BoundaryNames
              beforeName={participants[boundaryBeforeIndex]}
              afterName={participants[boundaryAfterIndex]}
              beforeColor={slices[boundaryBeforeIndex]?.color ?? WHEEL_COLORS[0]}
              afterColor={slices[boundaryAfterIndex]?.color ?? WHEEL_COLORS[1]}
              visible={showBoundaryNames}
              mode={isDartPresentation ? 'dart' : 'spin'}
            />
          )}
        </div>
      </div>

      <p className="roulette-wheel__status" aria-live="polite">
        {isIdleSpinning
          ? idleMotionPhase === 'spin-up'
            ? '원판이 추첨 대기 속도까지 가속하고 있습니다.'
            : '원판이 이름을 구별하기 어려운 고속으로 회전하고 있습니다.'
          : visuallySpinning
          ? '룰렛이 회전 중입니다.'
          : showWinner
            ? isPrizeDraw
              ? `당첨 상품은 ${participants[winnerIndex]}입니다.`
              : `당첨자는 ${participants[winnerIndex]}님입니다.`
            : participantCount > 0
              ? isPrizeDraw
                ? `${participantCount}개 상품이 준비되었습니다.`
                : `${participantCount}명의 참가자가 준비되었습니다.`
              : isPrizeDraw
                ? '아직 상품이 없습니다.'
                : '아직 참가자가 없습니다.'}
      </p>
    </section>
  );
}
