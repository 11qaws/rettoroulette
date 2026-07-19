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

type DartContactSpace = 'screen' | 'board';

const PROOF_NICKNAME_MAX_LENGTH = 8;

/**
 * One shared, head-on dart silhouette. The contact tip is deliberately the
 * last layer and sits at the glyph origin, so the judged point is never an
 * arbitrary sprite centre or the far end of the shaft.
 */
function DartGlyph({ contactSpace }: { contactSpace: DartContactSpace }) {
  const isScreenSpace = contactSpace === 'screen';
  const coreClassName = isScreenSpace
    ? 'dart-finish__projectile-core'
    : 'embedded-dart__core';
  const finClassName = isScreenSpace
    ? 'dart-finish__projectile-fin'
    : 'embedded-dart__fin';

  return (
    <>
      <span className="dart-glyph__shaft" />
      <span className={coreClassName} />
      <span className={`${finClassName} ${finClassName}--north`} />
      <span className={`${finClassName} ${finClassName}--east`} />
      <span className={`${finClassName} ${finClassName}--south`} />
      <span className={`${finClassName} ${finClassName}--west`} />
      <span
        className="dart-glyph__contact-tip"
        data-dart-contact-point={contactSpace}
      />
    </>
  );
}

function nicknameGraphemes(name: string) {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(
      new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(name),
      ({ segment }) => segment,
    );
  }

  return Array.from(name);
}

/** One stable proof-card line shared by boundary and interior results. */
function ProofNickname({ name }: { name: string }) {
  const fullName = name.trim() || '이름 없음';
  const characters = nicknameGraphemes(fullName);
  const isTruncated = characters.length > PROOF_NICKNAME_MAX_LENGTH;
  const displayName = isTruncated
    ? `${characters.slice(0, PROOF_NICKNAME_MAX_LENGTH - 1).join('')}…`
    : fullName;
  const visibleLength = Math.min(characters.length, PROOF_NICKNAME_MAX_LENGTH);
  const sizeClass = visibleLength >= 7
    ? ' boundary-names__text--compact'
    : visibleLength >= 5
      ? ' boundary-names__text--medium'
      : '';

  return (
    <span
      className={`boundary-names__text${sizeClass}${isTruncated ? ' is-truncated' : ''}`}
      title={fullName}
    >
      {displayName}
    </span>
  );
}

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
          <DartGlyph contactSpace="screen" />
        </span>

        <span className="dart-finish__impact-ring dart-finish__impact-ring--one" />
        <span className="dart-finish__impact-ring dart-finish__impact-ring--two" />
        <span className="dart-finish__impact-spark dart-finish__impact-spark--one" />
        <span className="dart-finish__impact-spark dart-finish__impact-spark--two" />
        <span className="dart-finish__impact-spark dart-finish__impact-spark--three" />
      </span>
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
        <ProofNickname name={leftName} />
      </span>
      <span className="boundary-names__marker">경계</span>
      <span className={`boundary-names__candidate boundary-names__candidate--right${winnerSide === 'right' ? ' is-winner' : ''}`}>
        {winnerSide === 'right' && <span className="boundary-names__win">WIN!</span>}
        <ProofNickname name={rightName} />
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
  if (!visible) return null;

  const style: WinnerNameplateStyle = { '--candidate-color': color };

  return (
    <div
      className={`winner-nameplate winner-nameplate--${mode}${visible ? ' is-visible' : ''}`}
      aria-hidden="true"
    >
      <span className="boundary-names__candidate is-winner" style={style}>
        <span className="boundary-names__win">WIN!</span>
        <ProofNickname name={name} />
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
        <DartGlyph contactSpace="board" />
      </span>
    </span>
  );
}
