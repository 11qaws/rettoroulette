import type { CSSProperties } from 'react';

import { DART_FLIGHT_DURATION_SECONDS } from '../lib/roulette';
import './DartFinish.css';

/** The business state lives in App; these are visual beats only. */
export type DartFinishPhase = 'idle' | 'flight' | 'impact' | 'coast' | 'settled';

export interface DartFinishProps {
  phase: DartFinishPhase;
  boundaryHit?: boolean;
  /** Keeps the screen-space flight synchronized with the constant-speed rotor. */
  flightDurationSeconds?: number;
  className?: string;
}

type EmbeddedDartStyle = CSSProperties & {
  '--dart-impact-rotation': string;
};

type DartFinishStyle = CSSProperties & {
  '--dart-flight-duration': string;
};

type BoundaryNamesStyle = CSSProperties & {
  '--boundary-left-color': string;
  '--boundary-right-color': string;
};

type WinnerNameplateStyle = CSSProperties & {
  '--candidate-color': string;
};

/**
 * Screen-space flight and impact flash. The projectile is seen head-on: it
 * changes scale at one result-neutral upper-half point instead of entering
 * from a fake diagonal direction.
 */
export default function DartFinish({
  phase,
  boundaryHit = false,
  flightDurationSeconds = DART_FLIGHT_DURATION_SECONDS,
  className,
}: DartFinishProps) {
  const safeFlightDuration = Number.isFinite(flightDurationSeconds)
    ? Math.max(0.42, flightDurationSeconds)
    : DART_FLIGHT_DURATION_SECONDS;
  const style: DartFinishStyle = {
    '--dart-flight-duration': `${safeFlightDuration}s`,
  };
  const rootClassName = [
    'dart-finish',
    `dart-finish--${phase}`,
    boundaryHit ? 'is-boundary-hit' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName} data-phase={phase} style={style} aria-hidden="true">
      <span className="dart-finish__impact-anchor">
        <span className="dart-finish__flash" />
        <span className="dart-finish__speed-field" />
        <span className="dart-finish__target" data-dart-impact-anchor="screen">
          <span />
        </span>

        <span className="dart-finish__ring dart-finish__ring--one" />
        <span className="dart-finish__ring dart-finish__ring--two" />
        <span className="dart-finish__ring dart-finish__ring--three" />

        <span className="dart-finish__projectile">
          <span className="dart-glyph__shaft" />
          <span className="dart-finish__projectile-core" />
          <span className="dart-finish__projectile-fin dart-finish__projectile-fin--north" />
          <span className="dart-finish__projectile-fin dart-finish__projectile-fin--east" />
          <span className="dart-finish__projectile-fin dart-finish__projectile-fin--south" />
          <span className="dart-finish__projectile-fin dart-finish__projectile-fin--west" />
        </span>

        <span className="dart-finish__impact-ring dart-finish__impact-ring--one" />
        <span className="dart-finish__impact-ring dart-finish__impact-ring--two" />
        <span className="dart-finish__impact-spark dart-finish__impact-spark--one" />
        <span className="dart-finish__impact-spark dart-finish__impact-spark--two" />
        <span className="dart-finish__impact-spark dart-finish__impact-spark--three" />
      </span>
      <span className="dart-finish__boundary-callout">경계선!</span>
    </div>
  );
}

export interface BoundaryNamesProps {
  leftName: string;
  rightName: string;
  leftColor: string;
  rightColor: string;
  visible: boolean;
  namesVisible?: boolean;
  mode: 'spin' | 'dart';
  /** Moves the neutral card to the final twelve-o'clock proof point. */
  finalPoint?: boolean;
  /** Remains neutral until the physical stop proves which side won. */
  winnerSide?: 'left' | 'right';
}

export function isDartBoundaryPhaseVisible(phase: DartFinishPhase) {
  return phase === 'coast' || phase === 'settled';
}

/**
 * Fixed screen-space labels for the two slices touching the final boundary.
 * Both names remain neutral until the physical stop proves the result.
 */
export function BoundaryNames({
  leftName,
  rightName,
  leftColor,
  rightColor,
  visible,
  namesVisible = true,
  mode,
  finalPoint = false,
  winnerSide,
}: BoundaryNamesProps) {
  const style: BoundaryNamesStyle = {
    '--boundary-left-color': leftColor,
    '--boundary-right-color': rightColor,
  };

  return (
    <div
      className={`boundary-names boundary-names--${mode}${visible ? ' is-visible' : ''}${namesVisible ? ' has-names' : ' is-colors-only'}${finalPoint ? ' is-final-point' : ''}${winnerSide ? ' is-final' : ''}`}
      style={style}
      aria-hidden="true"
    >
      <span className={`boundary-names__candidate boundary-names__candidate--left${winnerSide === 'left' ? ' is-winner' : ''}`}>
        {winnerSide === 'left' && <span className="boundary-names__win">WIN!</span>}
        <span className="boundary-names__text">{leftName}</span>
      </span>
      <span className="boundary-names__marker">경계</span>
      <span className={`boundary-names__candidate boundary-names__candidate--right${winnerSide === 'right' ? ' is-winner' : ''}`}>
        {winnerSide === 'right' && <span className="boundary-names__win">WIN!</span>}
        <span className="boundary-names__text">{rightName}</span>
      </span>
    </div>
  );
}

export interface WinnerNameplateProps {
  name: string;
  color: string;
  visible: boolean;
  mode: 'spin' | 'dart';
}

/** Uses the boundary candidate card as the common proof language for interior stops. */
export function WinnerNameplate({ name, color, visible, mode }: WinnerNameplateProps) {
  const style: WinnerNameplateStyle = { '--candidate-color': color };

  return (
    <div
      className={`winner-nameplate winner-nameplate--${mode}${visible ? ' is-visible' : ''}`}
      aria-hidden="true"
    >
      <span className="boundary-names__candidate is-winner" style={style}>
        <span className="boundary-names__win">WIN!</span>
        <span className="boundary-names__text">{name}</span>
      </span>
    </div>
  );
}

export interface EmbeddedDartProps {
  phase: DartFinishPhase;
  /** Absolute rotor angle at the instant the dart hit its varied screen point. */
  impactRotation: number;
  boundaryHit?: boolean;
}

/**
 * Board-space dart. Its anchor counter-rotates only once to convert the fixed
 * screen impact point into a wheel-local coordinate. From then on the rotor
 * owns every movement, so the dart cannot drift away from the plate.
 */
export function EmbeddedDart({
  phase,
  impactRotation,
  boundaryHit = false,
}: EmbeddedDartProps) {
  const style: EmbeddedDartStyle = {
    '--dart-impact-rotation': `${-impactRotation}deg`,
  };

  return (
    <span
      className={`embedded-dart embedded-dart--${phase}${boundaryHit ? ' is-boundary-hit' : ''}`}
      style={style}
      aria-hidden="true"
    >
      <span className="embedded-dart__pin" data-dart-impact-anchor="board">
        <span className="dart-glyph__shaft" />
        <span className="embedded-dart__core" />
        <span className="embedded-dart__fin embedded-dart__fin--north" />
        <span className="embedded-dart__fin embedded-dart__fin--east" />
        <span className="embedded-dart__fin embedded-dart__fin--south" />
        <span className="embedded-dart__fin embedded-dart__fin--west" />
      </span>
    </span>
  );
}
