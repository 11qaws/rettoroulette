import './DartFinish.css';

/**
 * Visual states are driven by the broadcast canvas. The overlay never decides
 * a winner or advances a draw; it only presents the already-started dart shot.
 */
export type DartFinishPhase = 'idle' | 'launch' | 'approach' | 'impact' | 'settled';

export interface DartFinishProps {
  /** The current visual beat of one dart draw. */
  phase: DartFinishPhase;
  /** Lets the host add a layout-specific class without coupling this overlay to a stage. */
  className?: string;
}

/**
 * Decorative dart layer for a relative roulette stage.
 *
 * Place this as a child of the same positioned element as the wheel. Its impact
 * point is intentionally fixed near one o'clock, so the wheel moves under the
 * dart rather than the dart appearing to choose a slice.
 */
export default function DartFinish({ phase, className }: DartFinishProps) {
  const rootClassName = [
    'dart-finish',
    `dart-finish--${phase}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName} data-phase={phase} aria-hidden="true">
      <span className="dart-finish__focus" />
      <span className="dart-finish__target" />
      <span className="dart-finish__trail dart-finish__trail--long" />
      <span className="dart-finish__trail dart-finish__trail--short" />

      <span className="dart-finish__dart">
        <span className="dart-finish__tip" />
        <span className="dart-finish__shaft" />
        <span className="dart-finish__grip" />
        <span className="dart-finish__flight">
          <span />
          <span />
        </span>
      </span>

      <span className="dart-finish__impact-ring dart-finish__impact-ring--one" />
      <span className="dart-finish__impact-ring dart-finish__impact-ring--two" />
      <span className="dart-finish__impact-spark dart-finish__impact-spark--one" />
      <span className="dart-finish__impact-spark dart-finish__impact-spark--two" />
      <span className="dart-finish__impact-spark dart-finish__impact-spark--three" />
    </div>
  );
}
