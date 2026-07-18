import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, TransitionEvent } from 'react';

import DartFinish from './DartFinish';
import {
  buildRouletteFinishPlan,
  calculateDartPostImpactDuration,
  DART_FLIGHT_DURATION_SECONDS,
  getRouletteSliceGeometry,
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
  spinKey: number;
  /** Changes only the on-air reveal; the winner is selected outside this component. */
  presentation?: WheelPresentation;
  /** Visual-only finish placement, generated after the winner is committed. */
  landing?: RouletteFinishLanding;
  onSpinEnd: () => void;
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
const DART_APPROACH_DELAY = 720;
const DART_IMPACT_HIGHLIGHT_DELAY = 440;
const STOP_HOLD_DELAY = 320;
const DART_IDLE_DEGREES_PER_SECOND = 23;

type SpinPhase =
  | 'idle'
  | 'auto-whirl'
  | 'dart-flight'
  | 'dart-after-impact'
  | 'boundary-approach'
  | 'boundary-creep'
  | 'stop-hold';

type RouletteStyle = CSSProperties & {
  '--wheel-rotation': string;
  '--slice-count': number;
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
  spinKey,
  presentation = 'spin',
  landing,
  onSpinEnd,
}: RouletteWheelProps) {
  const [rotation, setRotation] = useState(0);
  const [postImpactDuration, setPostImpactDuration] = useState(1.55);
  const [isAnimating, setIsAnimating] = useState(false);
  const [spinPhase, setSpinPhase] = useState<SpinPhase>('idle');
  const [dartPhase, setDartPhase] = useState<'idle' | 'launch' | 'approach' | 'impact' | 'coast' | 'settled'>('idle');
  const lastSpinKey = useRef<number | null>(null);
  const completedSpinKey = useRef<number | null>(null);
  const completionFallbackTimer = useRef<number | null>(null);
  const stopHoldTimer = useRef<number | null>(null);
  const dartApproachTimer = useRef<number | null>(null);
  const dartImpactTimer = useRef<number | null>(null);
  const dartIdleFrame = useRef<number | null>(null);
  const onSpinEndRef = useRef(onSpinEnd);
  const discRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef(0);
  const finishPlanRef = useRef<RouletteFinishPlan | null>(null);
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

  const settleSpin = useCallback((completedKey: number) => {
    if (completedSpinKey.current === completedKey) return;

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
    setIsAnimating(false);
    setSpinPhase('idle');
    finishPlanRef.current = null;
    onSpinEndRef.current();
  }, []);

  useEffect(() => () => {
    if (completionFallbackTimer.current !== null) {
      window.clearTimeout(completionFallbackTimer.current);
    }
    if (stopHoldTimer.current !== null) window.clearTimeout(stopHoldTimer.current);
    if (dartApproachTimer.current !== null) window.clearTimeout(dartApproachTimer.current);
    if (dartImpactTimer.current !== null) window.clearTimeout(dartImpactTimer.current);
    if (dartIdleFrame.current !== null) window.cancelAnimationFrame(dartIdleFrame.current);
  }, []);

  useEffect(() => {
    if (spinning || completionFallbackTimer.current === null) return;
    window.clearTimeout(completionFallbackTimer.current);
    completionFallbackTimer.current = null;
  }, [spinning]);

  useEffect(() => {
    const shouldIdleSpin =
      isDartPresentation && participantCount > 0 && !spinning && !validWinner;
    if (!shouldIdleSpin) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    let previousTime: number | null = null;
    const tick = (time: number) => {
      if (previousTime !== null) {
        const elapsedSeconds = Math.min(64, time - previousTime) / 1_000;
        rotationRef.current += elapsedSeconds * DART_IDLE_DEGREES_PER_SECOND;
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
  }, [isDartPresentation, participantCount, spinning, validWinner]);

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
    setIsAnimating(true);

    const winnerGeometry = sliceGeometry[winnerIndex];
    const winnerSpan = winnerGeometry
      ? winnerGeometry.endAngle - winnerGeometry.startAngle
      : 0;
    const effectiveLanding = isDartPresentation
      ? {
          entryGapDegrees: landing?.entryGapDegrees ?? 10,
          // Dart impact is deliberately ambiguous at the boundary. The later
          // stop must be unmistakable, so it lands near the slice centre.
          leadDegrees: winnerSpan / 2,
        }
      : landing;

    const firstFinishPlan = buildRouletteFinishPlan(
      rotationRef.current,
      winnerIndex,
      participantCount,
      isDartPresentation ? 2 + (Math.abs(spinKey) % 2) : 6 + (Math.abs(spinKey) % 3),
      weights,
      effectiveLanding,
    );
    const finishPlan = isDartPresentation
      ? {
          ...firstFinishPlan,
          // One coast turn keeps the board's motion legible after impact. The
          // remaining half-slice then places the winner clearly at twelve.
          finalRotation:
            firstFinishPlan.boundaryRotation + 360 + firstFinishPlan.leadDegrees,
        }
      : firstFinishPlan;
    finishPlanRef.current = finishPlan;

    let plannedPostImpactDuration = 1.55;
    if (isDartPresentation) {
      const flightDistance = Math.max(
        1,
        firstFinishPlan.boundaryRotation - rotationRef.current,
      );
      const coastDistance = finishPlan.finalRotation - firstFinishPlan.boundaryRotation;
      // The CSS curve is p(t)=2t-t²: it begins at exactly 2× average speed and
      // decreases continuously to zero. This duration therefore matches the
      // incoming linear velocity without any post-impact acceleration.
      plannedPostImpactDuration = calculateDartPostImpactDuration(
        flightDistance,
        coastDistance,
      );
      setPostImpactDuration(plannedPostImpactDuration);
    }

    if (completionFallbackTimer.current !== null) {
      window.clearTimeout(completionFallbackTimer.current);
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const fallbackDelay = reduceMotion
      ? 1_000
      : isDartPresentation
        ? Math.ceil((
            DART_FLIGHT_DURATION_SECONDS +
            plannedPostImpactDuration +
            STOP_HOLD_DELAY / 1_000 +
            0.8
          ) * 1_000)
        : 6_400;
    completionFallbackTimer.current = window.setTimeout(() => {
      if (lastSpinKey.current !== spinKey || completedSpinKey.current === spinKey) return;

      const activePlan = finishPlanRef.current;
      if (!activePlan) return;
      rotationRef.current = activePlan.finalRotation;
      setRotation(activePlan.finalRotation);
      setDartPhase(isDartPresentation ? 'settled' : 'idle');
      setSpinPhase('stop-hold');
      stopHoldTimer.current = window.setTimeout(() => settleSpin(spinKey), STOP_HOLD_DELAY);
    }, fallbackDelay);

    if (isDartPresentation) {
      setDartPhase('launch');
      dartApproachTimer.current = window.setTimeout(() => {
        if (lastSpinKey.current === spinKey && completedSpinKey.current !== spinKey) {
          setDartPhase('approach');
        }
      }, DART_APPROACH_DELAY);
      rotationRef.current = finishPlan.boundaryRotation;
      setSpinPhase('dart-flight');
      setRotation(finishPlan.boundaryRotation);
      return;
    }

    rotationRef.current = finishPlan.focusRotation;
    setSpinPhase('auto-whirl');
    setRotation(finishPlan.focusRotation);
  }, [isDartPresentation, landing, participantCount, settleSpin, sliceGeometry, spinKey, spinning, weights, winnerIndex]);

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
      setDartPhase('impact');
      if (dartImpactTimer.current !== null) window.clearTimeout(dartImpactTimer.current);
      // Impact only answers "did it hit the boundary?". The winner stays
      // hidden while the board coasts, then becomes clear at the final stop.
      dartImpactTimer.current = window.setTimeout(() => {
        if (lastSpinKey.current !== spinKey || completedSpinKey.current === spinKey) return;
        dartImpactTimer.current = null;
        setDartPhase('coast');
      }, DART_IMPACT_HIGHLIGHT_DELAY);
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
      setDartPhase('settled');
      setSpinPhase('stop-hold');
      stopHoldTimer.current = window.setTimeout(() => settleSpin(spinKey), STOP_HOLD_DELAY);
      return;
    }

    if (spinPhase === 'auto-whirl') {
      rotationRef.current = finishPlan.boundaryRotation;
      setSpinPhase('boundary-approach');
      setRotation(finishPlan.boundaryRotation);
      return;
    }

    if (spinPhase === 'boundary-approach') {
      if (isDartPresentation) setDartPhase('settled');
      rotationRef.current = finishPlan.finalRotation;
      setSpinPhase('boundary-creep');
      setRotation(finishPlan.finalRotation);
      return;
    }

    if (spinPhase === 'boundary-creep') {
      setSpinPhase('stop-hold');
      stopHoldTimer.current = window.setTimeout(() => settleSpin(spinKey), STOP_HOLD_DELAY);
    }
  };

  const visuallySpinning = spinning && isAnimating;
  const showWinner = validWinner && !spinning && !visuallySpinning;
  const isBoundaryFocus = spinPhase === 'boundary-approach' || spinPhase === 'boundary-creep';
  const isDartReady = isDartPresentation && participantCount > 0 && !spinning && !validWinner;
  const rootClassName = [
    'roulette-wheel',
    visuallySpinning ? 'is-spinning' : '',
    isDartPresentation ? 'is-dart' : '',
    isDartReady ? 'is-dart-ready' : '',
    spinPhase === 'auto-whirl' ? 'is-auto-whirl' : '',
    spinPhase === 'dart-flight' ? 'is-dart-flight' : '',
    spinPhase === 'dart-after-impact' ? 'is-dart-after-impact' : '',
    isBoundaryFocus ? 'is-boundary-focus' : '',
    spinPhase === 'boundary-approach' ? 'is-boundary-approach' : '',
    spinPhase === 'boundary-creep' ? 'is-boundary-creep' : '',
    spinPhase === 'stop-hold' ? 'is-stop-hold' : '',
    showWinner ? 'has-result' : '',
    participantCount === 0 ? 'is-empty' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const wheelStyle: RouletteStyle = {
    '--wheel-rotation': `${rotation}deg`,
    '--slice-count': Math.max(1, participantCount),
    '--wheel-post-impact-duration': `${postImpactDuration}s`,
  };

  return (
    <section className={rootClassName} data-spin-phase={spinPhase} aria-label="Retto Roulette 추첨 룰렛">
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
          </div>

          {isDartPresentation && <DartFinish phase={dartPhase} />}

          <div className="roulette-wheel__hub" aria-hidden="true">
            <span>RETTO</span>
            <small>ROULETTE</small>
          </div>
        </div>
      </div>

      <p className="roulette-wheel__status" aria-live="polite">
        {visuallySpinning
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
