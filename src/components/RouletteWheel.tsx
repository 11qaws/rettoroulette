import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, TransitionEvent } from 'react';

import DartFinish from './DartFinish';
import {
  AUTO_POINTER_ANGLE,
  DART_IMPACT_ANGLE,
  getRouletteSliceGeometry,
  nextWheelRotation,
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
const AUTO_FINALE_TURNS = 0.78;
const DART_APPROACH_DELAY = 860;
const DART_IMPACT_DELAY = 1_920;

type SpinPhase = 'idle' | 'auto-whirl' | 'auto-finale' | 'dart';

type RouletteStyle = CSSProperties & {
  '--wheel-rotation': string;
  '--slice-count': number;
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
  onSpinEnd,
}: RouletteWheelProps) {
  const [rotation, setRotation] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [spinPhase, setSpinPhase] = useState<SpinPhase>('idle');
  const [dartPhase, setDartPhase] = useState<'idle' | 'launch' | 'approach' | 'impact' | 'settled'>('idle');
  const lastSpinKey = useRef<number | null>(null);
  const completedSpinKey = useRef<number | null>(null);
  const completionFallbackTimer = useRef<number | null>(null);
  const onSpinEndRef = useRef(onSpinEnd);
  const rotationRef = useRef(0);
  const finalRotationRef = useRef<number | null>(null);
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
    setIsAnimating(false);
    setSpinPhase('idle');
    finalRotationRef.current = null;
    onSpinEndRef.current();
  }, []);

  useEffect(() => () => {
    if (completionFallbackTimer.current !== null) {
      window.clearTimeout(completionFallbackTimer.current);
    }
  }, []);

  useEffect(() => {
    if (spinning || completionFallbackTimer.current === null) return;
    window.clearTimeout(completionFallbackTimer.current);
    completionFallbackTimer.current = null;
  }, [spinning]);

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

    const finalRotation = nextWheelRotation(
      rotationRef.current,
      winnerIndex,
      participantCount,
      isDartPresentation ? 2 + (Math.abs(spinKey) % 2) : 6 + (Math.abs(spinKey) % 3),
      isDartPresentation ? DART_IMPACT_ANGLE : AUTO_POINTER_ANGLE,
      weights,
    );

    finalRotationRef.current = finalRotation;

    if (completionFallbackTimer.current !== null) {
      window.clearTimeout(completionFallbackTimer.current);
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const fallbackDelay = reduceMotion
      ? (isDartPresentation ? 1_000 : 1_400)
      : (isDartPresentation ? 2_900 : 5_800);
    completionFallbackTimer.current = window.setTimeout(() => {
      if (lastSpinKey.current !== spinKey || completedSpinKey.current === spinKey) return;

      const settledRotation = finalRotationRef.current;
      if (settledRotation !== null) {
        rotationRef.current = settledRotation;
        setRotation(settledRotation);
      }
      settleSpin(spinKey);
    }, fallbackDelay);

    if (isDartPresentation) {
      rotationRef.current = finalRotation;
      setSpinPhase('dart');
      setRotation(finalRotation);
      return;
    }

    // The first transition carries most of the momentum. The last 0.78 turn
    // is deliberately held for the on-air slow approach below.
    const preFinalRotation = finalRotation - AUTO_FINALE_TURNS * 360;
    rotationRef.current = preFinalRotation;
    setSpinPhase('auto-whirl');
    setRotation(preFinalRotation);
  }, [isDartPresentation, participantCount, settleSpin, spinKey, spinning, weights, winnerIndex]);

  useEffect(() => {
    if (!isDartPresentation) {
      setDartPhase('idle');
      return undefined;
    }

    if (!spinning || !validWinner) {
      setDartPhase(validWinner ? 'settled' : 'idle');
      return undefined;
    }

    setDartPhase('launch');
    const approachTimer = window.setTimeout(() => setDartPhase('approach'), DART_APPROACH_DELAY);
    const impactTimer = window.setTimeout(() => setDartPhase('impact'), DART_IMPACT_DELAY);

    return () => {
      window.clearTimeout(approachTimer);
      window.clearTimeout(impactTimer);
    };
  }, [isDartPresentation, spinKey, spinning, validWinner]);

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (
      event.target !== event.currentTarget ||
      event.propertyName !== 'transform' ||
      !isAnimating
    ) {
      return;
    }

    if (spinPhase === 'auto-whirl') {
      const finalRotation = finalRotationRef.current;

      if (finalRotation !== null) {
        rotationRef.current = finalRotation;
        setSpinPhase('auto-finale');
        setRotation(finalRotation);
        return;
      }
    }

    settleSpin(spinKey);
  };

  const visuallySpinning = spinning && isAnimating;
  const rootClassName = [
    'roulette-wheel',
    visuallySpinning ? 'is-spinning' : '',
    isDartPresentation ? 'is-dart' : '',
    isDartPresentation ? 'is-arrow-shot' : '',
    spinPhase === 'auto-whirl' ? 'is-auto-whirl' : '',
    spinPhase === 'auto-finale' ? 'is-auto-finale' : '',
    spinPhase === 'dart' ? 'is-arrow-flight' : '',
    validWinner && !spinning && !visuallySpinning ? 'has-result' : '',
    participantCount === 0 ? 'is-empty' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const wheelStyle: RouletteStyle = {
    '--wheel-rotation': `${rotation}deg`,
    '--slice-count': Math.max(1, participantCount),
  };

  return (
    <section className={rootClassName} aria-label="Retto Roulette 추첨 룰렛">
      <div className="roulette-wheel__stage">
        <span className="roulette-wheel__spark roulette-wheel__spark--one" aria-hidden="true">✦</span>
        <span className="roulette-wheel__spark roulette-wheel__spark--two" aria-hidden="true">●</span>
        <span className="roulette-wheel__spark roulette-wheel__spark--three" aria-hidden="true">★</span>

        <div className="roulette-wheel__pointer" aria-hidden="true">
          <span className="roulette-wheel__pointer-pin" />
        </div>

        <div className="roulette-wheel__rim">
          <div
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
                          validWinner && slice.index === winnerIndex
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
          : validWinner
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
