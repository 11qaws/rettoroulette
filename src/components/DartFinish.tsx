import './DartFinish.css';

/**
 * The broadcast canvas owns the timing. This layer only presents an already
 * selected result as a lottery-dart shot and never affects draw state.
 */
export type DartFinishPhase = 'idle' | 'launch' | 'approach' | 'impact' | 'coast' | 'settled';

export interface DartFinishProps {
  /** The current visual beat of one dart shot. */
  phase: DartFinishPhase;
  /** Lets the host add a layout-specific class without coupling this overlay to a stage. */
  className?: string;
}

/**
 * Lottery-dart finish for a relative roulette stage.
 *
 * The impact point stays fixed at twelve o'clock. The wheel moves beneath the
 * point while this overlay turns the shot into a short dart-follow camera
 * moment, briefly clears the impact flash while the board coasts, then leaves
 * the physical dart embedded as the result pointer.
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
      <div className="dart-finish__pov">
        <span className="dart-finish__vignette" />
        <span className="dart-finish__pov-glow" />

        <span className="dart-finish__corridor-ring dart-finish__corridor-ring--one" />
        <span className="dart-finish__corridor-ring dart-finish__corridor-ring--two" />
        <span className="dart-finish__corridor-ring dart-finish__corridor-ring--three" />

        <span className="dart-finish__corridor-lane dart-finish__corridor-lane--one" />
        <span className="dart-finish__corridor-lane dart-finish__corridor-lane--two" />
        <span className="dart-finish__corridor-lane dart-finish__corridor-lane--three" />
        <span className="dart-finish__corridor-lane dart-finish__corridor-lane--four" />
        <span className="dart-finish__corridor-lane dart-finish__corridor-lane--five" />
        <span className="dart-finish__corridor-lane dart-finish__corridor-lane--six" />
        <span className="dart-finish__corridor-lane dart-finish__corridor-lane--seven" />
        <span className="dart-finish__corridor-lane dart-finish__corridor-lane--eight" />

        <span className="dart-finish__pov-arrowhead" />
      </div>

      <span className="dart-finish__focus" />
      <span className="dart-finish__target">
        <span className="dart-finish__target-core" />
      </span>

      <span className="dart-finish__camera-arrow">
        <span className="dart-finish__camera-shaft" />
        <span className="dart-finish__camera-feathers">
          <span />
          <span />
        </span>
      </span>

      <span className="dart-finish__arrow">
        <span className="dart-finish__arrowhead" />
        <span className="dart-finish__shaft" />
        <span className="dart-finish__binding" />
        <span className="dart-finish__fletching">
          <span />
          <span />
        </span>
        <span className="dart-finish__nock" />
      </span>

      <span className="dart-finish__impact-ring dart-finish__impact-ring--one" />
      <span className="dart-finish__impact-ring dart-finish__impact-ring--two" />
      <span className="dart-finish__impact-spark dart-finish__impact-spark--one" />
      <span className="dart-finish__impact-spark dart-finish__impact-spark--two" />
      <span className="dart-finish__impact-spark dart-finish__impact-spark--three" />
    </div>
  );
}
