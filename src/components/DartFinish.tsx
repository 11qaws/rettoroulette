import type { CSSProperties } from 'react';

import './DartFinish.css';

/** The business state lives in App; these are visual beats only. */
export type DartFinishPhase = 'idle' | 'launch' | 'approach' | 'impact' | 'coast' | 'settled';

export interface DartFinishProps {
  phase: DartFinishPhase;
  boundaryHit?: boolean;
  className?: string;
}

type EmbeddedDartStyle = CSSProperties & {
  '--dart-impact-rotation': string;
};

/**
 * Screen-space flight and impact flash. The projectile is seen head-on: it
 * stays on the twelve-o'clock axis and changes scale instead of entering from
 * a fake diagonal direction.
 */
export default function DartFinish({
  phase,
  boundaryHit = false,
  className,
}: DartFinishProps) {
  const rootClassName = [
    'dart-finish',
    `dart-finish--${phase}`,
    boundaryHit ? 'is-boundary-hit' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName} data-phase={phase} aria-hidden="true">
      <span className="dart-finish__flash" />
      <span className="dart-finish__speed-field" />

      <span className="dart-finish__ring dart-finish__ring--one" />
      <span className="dart-finish__ring dart-finish__ring--two" />
      <span className="dart-finish__ring dart-finish__ring--three" />

      <span className="dart-finish__projectile">
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
      <span className="dart-finish__boundary-callout">경계선!</span>
    </div>
  );
}

export interface EmbeddedDartProps {
  phase: DartFinishPhase;
  /** Absolute rotor angle at the instant the dart hit twelve o'clock. */
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
      <span className="embedded-dart__pin">
        <span className="embedded-dart__core" />
        <span className="embedded-dart__fin embedded-dart__fin--north" />
        <span className="embedded-dart__fin embedded-dart__fin--east" />
        <span className="embedded-dart__fin embedded-dart__fin--south" />
        <span className="embedded-dart__fin embedded-dart__fin--west" />
      </span>
    </span>
  );
}
