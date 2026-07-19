import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CSSProperties, TransitionEvent } from 'react';

import DartFinish, {
  BoundaryNames,
  EmbeddedDart,
  isDartBoundaryPhaseVisible,
  WinnerNameplate,
  type DartFinishPhase,
} from './DartFinish';
import {
  buildCommittedDartRouletteFinishPlan,
  buildRouletteFinishPlan,
  calculateAutoPhotoFinishTiming,
  calculateDartPostImpactDuration,
  createRouletteGeometrySignature,
  DART_FLIGHT_DURATION_SECONDS,
  getRouletteSliceGeometry,
  isRoulettePhotoFinish,
  resolveDartImpactPoint,
  sampleDartAimSession,
  type DartAimSession,
  type DartPhysicalCommit,
  type DartShotPlan,
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
  /** One result-neutral, physically shared impact point for a dart reveal. */
  dartShot?: DartShotPlan;
  /** Moving result-neutral target shown before a live dart is committed. */
  dartAim?: DartAimSession;
  /** Click-time physical impact that selected the dart winner. */
  dartCommit?: DartPhysicalCommit;
  /** Physical reveal beats used by the camera, sound, lighting and status UI. */
  onRevealPhase?: (event: RouletteRevealEvent) => void;
  /** Enables the host action only after the live rotor reaches cruise speed. */
  onIdleCruise?: () => void;
  onSpinEnd: (event: RouletteSpinEndEvent) => void;
}

export interface DartAimCapture {
  shot: DartShotPlan;
  rotation: number;
  angularVelocity: number;
}

export interface RouletteWheelHandle {
  /** Freezes exactly the last aim sample painted with the live rotor. */
  freezeDartAim: () => DartAimCapture | null;
}

export interface RouletteSpinEndEvent {
  spinKey: number;
  revealId: number;
}

export type RouletteRevealPhase =
  | 'boundary-entered'
  | 'boundary-crossed'
  | 'boundary-held'
  | 'dart-launched'
  | 'dart-impacted'
  | 'dart-attached'
  | 'dart-names-revealed'
  | 'rotation-stopped'
  | 'proof-hold-done';

export interface RouletteRevealMetadata {
  presentation: WheelPresentation;
  winnerIndex: number | null;
  participantCount: number;
  boundaryHit?: boolean;
  candidateBefore?: string;
  candidateAfter?: string;
  landingKind?: RouletteFinishPlan['landingKind'];
  boundarySide?: RouletteFinishPlan['boundarySide'];
  winnerDisplaySide?: RouletteFinishPlan['winnerDisplaySide'];
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
const WHEEL_RADIUS = VIEWBOX_CENTER + 4;
const DART_IMPACT_HIGHLIGHT_DELAY = 220;
const STOP_HOLD_DELAY = 950;
const DART_STOP_HOLD_DELAY = STOP_HOLD_DELAY;
const BOUNDARY_RESOLVED_HOLD_DELAY = 220;
const IDLE_SPIN_ACCELERATION_MS = 900;
const IDLE_SPIN_DEGREES_PER_SECOND = 1080;
const AUTO_WHIRL_FULL_TURNS = 4;
const DART_ATTACHED_PROOF_SECONDS = 0.28;
const DART_ATTACHED_COAST_TURNS = 2;

type SpinPhase =
  | 'idle'
  | 'auto-brake'
  | 'auto-photo-finish'
  | 'dart-flight'
  | 'dart-attached-proof'
  | 'dart-after-impact'
  | 'stop-hold';

type IdleMotionPhase = 'stopped' | 'spin-up' | 'cruise';
type BoundaryVisualPhase = 'idle' | 'approach' | 'crossed' | 'held';

type LandingVisualState = {
  spinKey: number;
  kind: RouletteFinishPlan['landingKind'];
  boundarySide: RouletteFinishPlan['boundarySide'];
  leftIndex: number | null;
  rightIndex: number | null;
  winnerSide: 'left' | 'right' | null;
  crossesBoundary: boolean;
};

type ActiveWheelRun = {
  spinKey: number;
  revealId: number;
  phase: SpinPhase;
  transitionSeconds: number;
  transitionNotBefore: number;
  completed: boolean;
};

type RouletteStyle = CSSProperties & {
  '--slice-count': number;
  '--wheel-auto-whirl-duration': string;
  '--wheel-auto-brake-ease': string;
  '--wheel-photo-finish-duration': string;
  '--wheel-dart-flight-duration': string;
  '--wheel-dart-attached-duration': string;
  '--wheel-post-impact-duration': string;
};

type RouletteDiscStyle = CSSProperties & {
  '--wheel-rotation': string;
};

type RouletteImpactStyle = CSSProperties & {
  '--dart-impact-x': string;
  '--dart-impact-y': string;
  '--dart-final-x': string;
  '--dart-final-y': string;
  '--dart-jitter-a-x': string;
  '--dart-jitter-a-y': string;
  '--dart-jitter-b-x': string;
  '--dart-jitter-b-y': string;
  '--dart-roll': string;
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

const RouletteWheel = forwardRef<RouletteWheelHandle, RouletteWheelProps>(function RouletteWheel({
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
  dartShot,
  dartAim,
  dartCommit,
  onRevealPhase,
  onIdleCruise,
  onSpinEnd,
}: RouletteWheelProps, ref) {
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
  const [dartPhase, setDartPhase] = useState<DartFinishPhase>('idle');
  const [dartImpactRotation, setDartImpactRotation] = useState(0);
  const [landingBoundaryHit, setLandingBoundaryHit] = useState(false);
  const [landingVisual, setLandingVisual] = useState<LandingVisualState | null>(null);
  const [dartNamesRevealed, setDartNamesRevealed] = useState(false);
  const [dartAimLocked, setDartAimLocked] = useState(false);
  const [displayAimShot, setDisplayAimShot] = useState<DartShotPlan | undefined>(dartShot);
  const lastSpinKey = useRef<number | null>(null);
  const completedSpinKey = useRef<number | null>(null);
  const completionFallbackTimer = useRef<number | null>(null);
  const stopHoldTimer = useRef<number | null>(null);
  const dartImpactTimer = useRef<number | null>(null);
  const dartNameRevealTimer = useRef<number | null>(null);
  const boundaryEnteredTimer = useRef<number | null>(null);
  const boundaryCrossedTimer = useRef<number | null>(null);
  const dartIdleFrame = useRef<number | null>(null);
  const onSpinEndRef = useRef(onSpinEnd);
  const onRevealPhaseRef = useRef(onRevealPhase);
  const onIdleCruiseRef = useRef(onIdleCruise);
  const discRef = useRef<HTMLDivElement>(null);
  const rimRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef(0);
  const activeRevealIdRef = useRef(revealId ?? spinKey);
  const activeRunRef = useRef<ActiveWheelRun | null>(null);
  const idleAngularVelocityRef = useRef(0);
  const dartAimRef = useRef<DartAimSession | undefined>(dartAim);
  const dartAimFrozenRef = useRef(false);
  const lastPaintedAimRef = useRef<DartShotPlan | null>(null);
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
  const dartImpactPoint = useMemo(
    () => resolveDartImpactPoint(dartCommit?.shot ?? dartShot ?? displayAimShot),
    [dartCommit, dartShot, displayAimShot],
  );
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

  const paintDartAim = useCallback((shot: DartShotPlan, committed = false) => {
    const point = resolveDartImpactPoint(shot);
    const rim = rimRef.current;
    if (rim) {
      rim.style.setProperty('--dart-impact-x', `${point.xPercent}%`);
      rim.style.setProperty('--dart-impact-y', `${point.yPercent}%`);
      rim.style.setProperty('--dart-final-x', `${point.finalXPercent}%`);
      rim.style.setProperty('--dart-final-y', `${point.finalYPercent}%`);
      rim.style.setProperty('--dart-jitter-a-x', `${point.jitterA.xPixels}px`);
      rim.style.setProperty('--dart-jitter-a-y', `${point.jitterA.yPixels}px`);
      rim.style.setProperty('--dart-jitter-b-x', `${point.jitterB.xPixels}px`);
      rim.style.setProperty('--dart-jitter-b-y', `${point.jitterB.yPixels}px`);
      rim.style.setProperty('--dart-roll', `${point.rollDegrees}deg`);
      if (committed) {
        rim.dataset.dartImpactX = point.xPercent.toFixed(3);
        rim.dataset.dartImpactY = point.yPercent.toFixed(3);
      }
    }
    lastPaintedAimRef.current = {
      impactAngleDegrees: point.impactAngleDegrees,
      impactRadiusRatio: point.impactRadiusRatio,
      jitterA: { ...point.jitterA },
      jitterB: { ...point.jitterB },
      rollDegrees: point.rollDegrees,
    };
  }, []);

  useEffect(() => {
    dartAimRef.current = dartAim;
    dartAimFrozenRef.current = false;
    setDartAimLocked(false);
    if (!dartAim) return;

    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    const shot = sampleDartAimSession(dartAim, now);
    lastPaintedAimRef.current = shot;
    setDisplayAimShot(shot);
    paintDartAim(shot);
  }, [dartAim, paintDartAim]);

  useEffect(() => {
    if (!dartShot) return;
    dartAimFrozenRef.current = true;
    lastPaintedAimRef.current = dartShot;
    setDisplayAimShot(dartShot);
    paintDartAim(dartShot, true);
  }, [dartShot, paintDartAim]);

  useImperativeHandle(ref, () => ({
    freezeDartAim: () => {
      if (!isDartPresentation) return null;
      let shot = lastPaintedAimRef.current;
      if (!shot && dartAimRef.current) {
        const now = typeof performance === 'undefined' ? Date.now() : performance.now();
        shot = sampleDartAimSession(dartAimRef.current, now);
        paintDartAim(shot);
      }
      if (!shot) return null;

      dartAimFrozenRef.current = true;
      setDartAimLocked(true);
      setDisplayAimShot(shot);
      paintDartAim(shot, true);
      return {
        shot: {
          impactAngleDegrees: shot.impactAngleDegrees,
          impactRadiusRatio: shot.impactRadiusRatio,
          jitterA: { ...shot.jitterA },
          jitterB: { ...shot.jitterB },
          rollDegrees: shot.rollDegrees,
        },
        rotation: rotationRef.current,
        angularVelocity: idleAngularVelocityRef.current > 1
          ? idleAngularVelocityRef.current
          : IDLE_SPIN_DEGREES_PER_SECOND,
      };
    },
  }), [isDartPresentation, paintDartAim]);

  const clearRunTimers = useCallback(() => {
    if (completionFallbackTimer.current !== null) {
      window.clearTimeout(completionFallbackTimer.current);
      completionFallbackTimer.current = null;
    }
    if (stopHoldTimer.current !== null) {
      window.clearTimeout(stopHoldTimer.current);
      stopHoldTimer.current = null;
    }
    if (dartImpactTimer.current !== null) {
      window.clearTimeout(dartImpactTimer.current);
      dartImpactTimer.current = null;
    }
    if (dartNameRevealTimer.current !== null) {
      window.clearTimeout(dartNameRevealTimer.current);
      dartNameRevealTimer.current = null;
    }
    if (boundaryEnteredTimer.current !== null) {
      window.clearTimeout(boundaryEnteredTimer.current);
      boundaryEnteredTimer.current = null;
    }
    if (boundaryCrossedTimer.current !== null) {
      window.clearTimeout(boundaryCrossedTimer.current);
      boundaryCrossedTimer.current = null;
    }
  }, []);

  const isActiveRun = useCallback((runSpinKey: number, runRevealId: number) => {
    const run = activeRunRef.current;
    return Boolean(
      run &&
      !run.completed &&
      run.spinKey === runSpinKey &&
      run.revealId === runRevealId,
    );
  }, []);

  const activateRunPhase = useCallback((
    runSpinKey: number,
    runRevealId: number,
    phase: SpinPhase,
    nominalTransitionSeconds = 0,
  ) => {
    const run = activeRunRef.current;
    if (
      !run ||
      run.completed ||
      run.spinKey !== runSpinKey ||
      run.revealId !== runRevealId
    ) return false;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const transitionSeconds = reducedMotion && nominalTransitionSeconds > 0
      ? 0.06
      : nominalTransitionSeconds;
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    run.phase = phase;
    run.transitionSeconds = transitionSeconds;
    run.transitionNotBefore = now + transitionSeconds * 720;
    setSpinPhase(phase);
    return true;
  }, []);

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

  const settleSpin = useCallback((completedKey: number, completedRevealId: number) => {
    const run = activeRunRef.current;
    if (
      !run ||
      run.completed ||
      run.spinKey !== completedKey ||
      run.revealId !== completedRevealId ||
      completedSpinKey.current === completedKey
    ) return;

    emitRevealPhase('proof-hold-done', completedKey);
    run.phase = 'idle';
    run.completed = true;
    completedSpinKey.current = completedKey;
    clearRunTimers();
    setIsAnimating(false);
    setSpinPhase('idle');
    setBoundaryVisualPhase('idle');
    finishPlanRef.current = null;
    onSpinEndRef.current({ spinKey: completedKey, revealId: completedRevealId });
  }, [clearRunTimers, emitRevealPhase]);

  const beginProofHold = useCallback((
    revealKey: number,
    runRevealId: number,
    dartReveal: boolean,
  ) => {
    if (
      !isActiveRun(revealKey, runRevealId) ||
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
    activateRunPhase(revealKey, runRevealId, 'stop-hold');
    emitRevealPhase('rotation-stopped', revealKey);
    const proofHoldDelay = dartReveal ? DART_STOP_HOLD_DELAY : STOP_HOLD_DELAY;
    stopHoldTimer.current = window.setTimeout(() => {
      stopHoldTimer.current = null;
      if (!isActiveRun(revealKey, runRevealId)) return;
      settleSpin(revealKey, runRevealId);
    }, proofHoldDelay);
  }, [activateRunPhase, emitRevealPhase, isActiveRun, settleSpin]);

  useEffect(() => () => {
    clearRunTimers();
    if (dartIdleFrame.current !== null) window.cancelAnimationFrame(dartIdleFrame.current);
  }, [clearRunTimers]);

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
      if (isDartPresentation && !dartAimFrozenRef.current && dartAimRef.current) {
        paintDartAim(sampleDartAimSession(dartAimRef.current, time));
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
  }, [idleSpinning, isDartPresentation, paintDartAim, participantCount, spinning, validWinner]);

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

    clearRunTimers();
    lastSpinKey.current = spinKey;
    completedSpinKey.current = null;
    emittedRevealPhasesRef.current = new Set();
    setBoundaryVisualPhase('idle');
    setDartNamesRevealed(false);
    setIsAnimating(true);

    const startingRotation = rotationRef.current;
    const runRevealId = revealId ?? spinKey;
    activeRevealIdRef.current = runRevealId;
    activeRunRef.current = {
      spinKey,
      revealId: runRevealId,
      phase: 'idle',
      transitionSeconds: 0,
      transitionNotBefore: 0,
      completed: false,
    };
    // The idle rotor writes its current angle directly for 60fps motion.
    // Re-assert and flush that exact baseline before enabling a new CSS
    // transition so every consecutive reveal has a real start frame.
    discRef.current?.style.setProperty('--wheel-rotation', `${startingRotation}deg`);
    discRef.current?.getBoundingClientRect();
    let plannedAutoWhirlDuration = 4.2;
    let plannedPhotoFinishDuration = 0;
    let plannedDartFlightDuration = DART_FLIGHT_DURATION_SECONDS;
    let plannedPostImpactDuration = 1.55;
    let actualBoundaryHit = false;
    let finishPlan: RouletteFinishPlan | DartRouletteFinishPlan;

    if (isDartPresentation) {
      const cruiseVelocity = idleAngularVelocityRef.current > 1
        ? idleAngularVelocityRef.current
        : IDLE_SPIN_DEGREES_PER_SECOND;
      let dartPlan: DartRouletteFinishPlan;
      let flightAngularVelocity = cruiseVelocity;

      if (
        dartCommit
        && dartCommit.winnerIndex === winnerIndex
        && dartCommit.geometrySignature === createRouletteGeometrySignature(participantCount, weights)
      ) {
        dartPlan = buildCommittedDartRouletteFinishPlan(
          dartCommit,
          participantCount,
          DART_ATTACHED_COAST_TURNS,
          weights,
          startingRotation + cruiseVelocity * 0.42,
        );
        const flightDistance = Math.max(1, dartPlan.impactRotation - startingRotation);
        plannedDartFlightDuration = flightDistance / cruiseVelocity;
        flightAngularVelocity = flightDistance / plannedDartFlightDuration;
      } else {
        // A dart must never retarget a preselected winner. Live and preview
        // both require the same click-time physical commit.
        activeRunRef.current = null;
        setIsAnimating(false);
        return;
      }

      finishPlan = dartPlan;
      actualBoundaryHit = isRoulettePhotoFinish(
        dartCommit?.landing.boundaryHit ?? landing?.boundaryHit,
        participantCount,
        dartPlan,
      );

      const flightDistance = Math.max(1, dartPlan.impactRotation - startingRotation);
      const coastDistance = dartPlan.finalRotation - dartPlan.impactRotation;
      const attachedTravel = Math.min(
        coastDistance * 0.42,
        flightAngularVelocity * DART_ATTACHED_PROOF_SECONDS,
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
      actualBoundaryHit = isRoulettePhotoFinish(
        landing?.boundaryHit,
        participantCount,
        finishPlan,
      );
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
    const leftIndex = finishPlan.boundarySide === 'end'
      ? winnerIndex
      : finishPlan.boundarySide === 'start'
        ? finishPlan.adjacentIndex
        : null;
    const rightIndex = finishPlan.boundarySide === 'end'
      ? finishPlan.adjacentIndex
      : finishPlan.boundarySide === 'start'
        ? winnerIndex
        : null;
    const winnerDisplaySide = finishPlan.winnerDisplaySide;
    setLandingVisual({
      spinKey,
      kind: finishPlan.landingKind,
      boundarySide: finishPlan.boundarySide,
      leftIndex,
      rightIndex,
      winnerSide: winnerDisplaySide,
      crossesBoundary: finishPlan.crossesBoundary,
    });
    setLandingBoundaryHit(actualBoundaryHit);
    revealMetadataRef.current = {
      presentation,
      winnerIndex,
      participantCount,
      boundaryHit: actualBoundaryHit,
      candidateBefore: rightIndex === null ? undefined : participants[rightIndex],
      candidateAfter: leftIndex === null ? undefined : participants[leftIndex],
      landingKind: finishPlan.landingKind,
      boundarySide: finishPlan.boundarySide,
      winnerDisplaySide,
    };
    finishPlanRef.current = finishPlan;

    const fallbackDelay = isDartPresentation
      ? Math.ceil((
          plannedDartFlightDuration +
          DART_ATTACHED_PROOF_SECONDS +
          plannedPostImpactDuration +
          DART_STOP_HOLD_DELAY / 1_000 +
          0.8
        ) * 1_000)
      : Math.ceil((
          plannedAutoWhirlDuration
          + plannedPhotoFinishDuration
          + STOP_HOLD_DELAY / 1_000
          + 0.8
        ) * 1_000);
    completionFallbackTimer.current = window.setTimeout(() => {
      if (!isActiveRun(spinKey, runRevealId)) return;

      const activePlan = finishPlanRef.current;
      if (!activePlan) return;
      rotationRef.current = activePlan.finalRotation;
      setRotation(activePlan.finalRotation);
      if (isDartPresentation) {
        emitRevealPhase('dart-impacted', spinKey);
        emitRevealPhase('dart-attached', spinKey);
        setDartNamesRevealed(true);
        emitRevealPhase('dart-names-revealed', spinKey);
      } else if (actualBoundaryHit) {
        setBoundaryVisualPhase(activePlan.crossesBoundary ? 'crossed' : 'held');
        emitRevealPhase('boundary-entered', spinKey);
        emitRevealPhase(activePlan.crossesBoundary ? 'boundary-crossed' : 'boundary-held', spinKey);
        boundaryEnteredTimer.current = window.setTimeout(() => {
          boundaryEnteredTimer.current = null;
          if (!isActiveRun(spinKey, runRevealId)) return;
          beginProofHold(spinKey, runRevealId, false);
        }, BOUNDARY_RESOLVED_HOLD_DELAY);
        return;
      }
      beginProofHold(spinKey, runRevealId, isDartPresentation);
    }, fallbackDelay);

    if (isDartPresentation) {
      setDartPhase('flight');
      emitRevealPhase('dart-launched', spinKey);
      rotationRef.current = finishPlan.boundaryRotation;
      activateRunPhase(spinKey, runRevealId, 'dart-flight', plannedDartFlightDuration);
      setRotation(finishPlan.boundaryRotation);
      return;
    }

    const firstAutoTarget = actualBoundaryHit ? finishPlan.focusRotation : finishPlan.finalRotation;
    rotationRef.current = firstAutoTarget;
    activateRunPhase(spinKey, runRevealId, 'auto-brake', plannedAutoWhirlDuration);
    setRotation(firstAutoTarget);
  }, [
    activateRunPhase,
    beginProofHold,
    clearRunTimers,
    dartCommit,
    dartShot,
    emitRevealPhase,
    isActiveRun,
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
    else if (!spinning && !validWinner) setDartPhase('idle');
  }, [isDartPresentation, spinning, validWinner]);

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (
      event.target !== event.currentTarget ||
      event.propertyName !== 'transform' ||
      !isAnimating
    ) {
      return;
    }

    const run = activeRunRef.current;
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    if (
      !run ||
      run.completed ||
      run.spinKey !== spinKey ||
      run.revealId !== (revealId ?? spinKey) ||
      now < run.transitionNotBefore
    ) return;

    const finishPlan = finishPlanRef.current;
    if (!finishPlan) return;
    const runRevealId = run.revealId;

    if (run.phase === 'dart-flight') {
      if (!('impactRotation' in finishPlan)) return;
      rotationRef.current = finishPlan.impactRotation;
      setDartPhase('impact');
      emitRevealPhase('dart-impacted', spinKey);
      if (dartImpactTimer.current !== null) window.clearTimeout(dartImpactTimer.current);
      // Impact only answers "did it hit the boundary?". The winner stays
      // hidden while the board coasts, then becomes clear at the final stop.
      dartImpactTimer.current = window.setTimeout(() => {
        if (!isActiveRun(spinKey, runRevealId)) return;
        dartImpactTimer.current = null;
        setDartPhase('coast');
        emitRevealPhase('dart-attached', spinKey);
      }, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : DART_IMPACT_HIGHLIGHT_DELAY);
      // The flight finishes on the exact contact transform. Start the
      // board-owned linear motion in this same state update so there is no
      // paused contact frame or second insertion step.
      rotationRef.current = dartAttachedRotationRef.current;
      activateRunPhase(
        spinKey,
        runRevealId,
        'dart-attached-proof',
        DART_ATTACHED_PROOF_SECONDS,
      );
      setRotation(dartAttachedRotationRef.current);
      return;
    }

    if (run.phase === 'dart-attached-proof') {
      if (dartImpactTimer.current !== null) {
        window.clearTimeout(dartImpactTimer.current);
        dartImpactTimer.current = null;
        setDartPhase('coast');
        emitRevealPhase('dart-attached', spinKey);
      }
      rotationRef.current = finishPlan.finalRotation;
      activateRunPhase(spinKey, runRevealId, 'dart-after-impact', postImpactDuration);
      setRotation(finishPlan.finalRotation);
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      const revealDelay = reducedMotion ? 0 : Math.max(0, postImpactDuration - 1) * 1_000;
      dartNameRevealTimer.current = window.setTimeout(() => {
        dartNameRevealTimer.current = null;
        if (!isActiveRun(spinKey, runRevealId)) return;
        setDartNamesRevealed(true);
        emitRevealPhase('dart-names-revealed', spinKey);
      }, revealDelay);
      return;
    }

    if (run.phase === 'dart-after-impact') {
      if (dartImpactTimer.current !== null) {
        window.clearTimeout(dartImpactTimer.current);
        dartImpactTimer.current = null;
      }
      if (dartNameRevealTimer.current !== null) {
        window.clearTimeout(dartNameRevealTimer.current);
        dartNameRevealTimer.current = null;
      }
      setDartNamesRevealed(true);
      emitRevealPhase('dart-names-revealed', spinKey);
      beginProofHold(spinKey, runRevealId, true);
      return;
    }

    if (run.phase === 'auto-brake') {
      if (!landingBoundaryHit) {
        beginProofHold(spinKey, runRevealId, false);
        return;
      }

      setBoundaryVisualPhase('approach');
      emitRevealPhase('boundary-entered', spinKey);
      if (finishPlan.crossesBoundary) {
        const photoFinishDistance = Math.max(0.1, finishPlan.finalRotation - finishPlan.focusRotation);
        const boundaryProgress = Math.min(
          1,
          Math.max(0, (finishPlan.boundaryRotation - finishPlan.focusRotation) / photoFinishDistance),
        );
        const crossedDelay = autoPhotoFinishDuration
          * (1 - Math.sqrt(1 - boundaryProgress))
          * 1_000;
        boundaryCrossedTimer.current = window.setTimeout(() => {
          if (!isActiveRun(spinKey, runRevealId)) return;
          boundaryCrossedTimer.current = null;
          setBoundaryVisualPhase('crossed');
          emitRevealPhase('boundary-crossed', spinKey);
        }, crossedDelay);
      }
      rotationRef.current = finishPlan.finalRotation;
      activateRunPhase(
        spinKey,
        runRevealId,
        'auto-photo-finish',
        autoPhotoFinishDuration,
      );
      setRotation(finishPlan.finalRotation);
      return;
    }

    if (run.phase === 'auto-photo-finish') {
      if (boundaryCrossedTimer.current !== null) {
        window.clearTimeout(boundaryCrossedTimer.current);
        boundaryCrossedTimer.current = null;
      }
      setBoundaryVisualPhase(finishPlan.crossesBoundary ? 'crossed' : 'held');
      emitRevealPhase(
        finishPlan.crossesBoundary ? 'boundary-crossed' : 'boundary-held',
        spinKey,
      );
      boundaryEnteredTimer.current = window.setTimeout(() => {
        boundaryEnteredTimer.current = null;
        if (!isActiveRun(spinKey, runRevealId)) return;
        beginProofHold(spinKey, runRevealId, false);
      }, BOUNDARY_RESOLVED_HOLD_DELAY);
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
  const currentLandingVisual = landingVisual?.spinKey === spinKey ? landingVisual : null;
  const boundaryLeftIndex = validWinner ? currentLandingVisual?.leftIndex ?? null : null;
  const boundaryRightIndex = validWinner ? currentLandingVisual?.rightIndex ?? null : null;
  const isDartBoundaryStop = Boolean(
    isDartPresentation &&
    participantCount > 1 &&
    validWinner &&
    landingBoundaryHit &&
    dartPhase === 'settled',
  );
  const showBoundaryNames = participantCount > 1 && validWinner && (
    (!isDartPresentation && landingBoundaryHit && (isBoundaryFocus || showWinner)) ||
    (isDartPresentation && landingBoundaryHit && dartNamesRevealed && isDartBoundaryPhaseVisible(dartPhase))
  );
  const isAutoBoundaryStopped = !isDartPresentation
    && landingBoundaryHit
    && (spinPhase === 'stop-hold' || showWinner);
  const boundaryWinnerSide =
    isAutoBoundaryStopped || isDartBoundaryStop
      ? currentLandingVisual?.winnerSide ?? undefined
      : undefined;
  const showBoundaryWinnerSlice = Boolean(
    validWinner &&
    landingBoundaryHit &&
    (
      isAutoBoundaryStopped ||
      isDartBoundaryStop
    ),
  );
  const showWinnerNameplate = Boolean(
    validWinner
    && !landingBoundaryHit
    && (spinPhase === 'stop-hold' || showWinner),
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
    spinPhase === 'dart-attached-proof' ? 'is-dart-attached-proof' : '',
    spinPhase === 'dart-after-impact' ? 'is-dart-after-impact' : '',
    isBoundaryFocus ? 'is-boundary-focus' : '',
    boundaryVisualPhase === 'approach' ? 'is-boundary-approach' : '',
    boundaryVisualPhase === 'crossed' ? 'is-boundary-creep' : '',
    boundaryVisualPhase === 'held' ? 'is-boundary-held' : '',
    spinPhase === 'stop-hold' ? 'is-stop-hold' : '',
    isDartBoundaryStop ? 'is-dart-boundary-stop' : '',
    dartNamesRevealed ? 'is-dart-names-revealed' : '',
    dartAimLocked ? 'is-dart-aim-locked' : '',
    showWinner ? 'has-result' : '',
    participantCount === 0 ? 'is-empty' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const wheelStyle: RouletteStyle = {
    '--slice-count': Math.max(1, participantCount),
    '--wheel-auto-whirl-duration': `${autoWhirlDuration}s`,
    '--wheel-auto-brake-ease': autoBrakeEase,
    '--wheel-photo-finish-duration': `${autoPhotoFinishDuration}s`,
    '--wheel-dart-flight-duration': `${dartFlightDuration}s`,
    '--wheel-dart-attached-duration': `${DART_ATTACHED_PROOF_SECONDS}s`,
    '--wheel-post-impact-duration': `${postImpactDuration}s`,
  };
  const discStyle: RouletteDiscStyle = {
    '--wheel-rotation': `${rotation}deg`,
  };
  const impactStyle: RouletteImpactStyle = {
    '--dart-impact-x': `${dartImpactPoint.xPercent}%`,
    '--dart-impact-y': `${dartImpactPoint.yPercent}%`,
    '--dart-final-x': `${dartImpactPoint.finalXPercent}%`,
    '--dart-final-y': `${dartImpactPoint.finalYPercent}%`,
    '--dart-jitter-a-x': `${dartImpactPoint.jitterA.xPixels}px`,
    '--dart-jitter-a-y': `${dartImpactPoint.jitterA.yPixels}px`,
    '--dart-jitter-b-x': `${dartImpactPoint.jitterB.xPixels}px`,
    '--dart-jitter-b-y': `${dartImpactPoint.jitterB.yPixels}px`,
    '--dart-roll': `${dartImpactPoint.rollDegrees}deg`,
  };

  return (
    <section
      className={rootClassName}
      data-spin-phase={spinPhase}
      data-run-phase={activeRunRef.current?.phase ?? 'none'}
      data-motion-phase={motionPhase}
      data-boundary-hit={landingBoundaryHit ? 'true' : 'false'}
      data-landing-kind={currentLandingVisual?.kind}
      data-boundary-side={currentLandingVisual?.boundarySide ?? undefined}
      data-winner-side={currentLandingVisual?.winnerSide ?? undefined}
      data-winner-index={validWinner ? winnerIndex : undefined}
      data-participant-count={participantCount}
      data-auto-whirl-duration={autoWhirlDuration.toFixed(3)}
      data-photo-finish-duration={autoPhotoFinishDuration.toFixed(3)}
      style={wheelStyle}
      aria-label="Retto Roulette 추첨 룰렛"
    >
      <div className="roulette-wheel__stage">
        <span className="roulette-wheel__spark roulette-wheel__spark--one" aria-hidden="true">✦</span>
        <span className="roulette-wheel__spark roulette-wheel__spark--two" aria-hidden="true">●</span>
        <span className="roulette-wheel__spark roulette-wheel__spark--three" aria-hidden="true">★</span>

        <div className="roulette-wheel__pointer" aria-hidden="true">
          <span className="roulette-wheel__pointer-needle">
            <span className="roulette-wheel__selection-anchor" />
          </span>
          <span className="roulette-wheel__pointer-pin" />
        </div>

        <div
          ref={rimRef}
          className="roulette-wheel__rim"
          style={impactStyle}
          data-dart-impact-x={dartImpactPoint.xPercent.toFixed(3)}
          data-dart-impact-y={dartImpactPoint.yPercent.toFixed(3)}
        >
          <div
            ref={discRef}
            className="roulette-wheel__disc"
            style={discStyle}
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
                        }${
                          showBoundaryWinnerSlice && slice.index === winnerIndex
                            ? ' roulette-wheel__slice--boundary-winner'
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

          {validWinner && participantCount > 1 && boundaryLeftIndex !== null && boundaryRightIndex !== null && (
            <BoundaryNames
              leftName={participants[boundaryLeftIndex]}
              rightName={participants[boundaryRightIndex]}
              leftColor={slices[boundaryLeftIndex]?.color ?? WHEEL_COLORS[0]}
              rightColor={slices[boundaryRightIndex]?.color ?? WHEEL_COLORS[1]}
              visible={showBoundaryNames}
              namesVisible={!isDartPresentation || dartNamesRevealed}
              mode={isDartPresentation ? 'dart' : 'spin'}
              finalPoint={isDartPresentation && dartNamesRevealed}
              winnerSide={boundaryWinnerSide}
            />
          )}
          {validWinner && winnerIndex !== null && (
            <WinnerNameplate
              name={participants[winnerIndex]}
              color={slices[winnerIndex]?.color ?? WHEEL_COLORS[0]}
              visible={showWinnerNameplate}
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
});

export default RouletteWheel;
