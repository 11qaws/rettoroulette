import { useId, type ReactNode } from 'react';

import './BroadcastActionDock.css';

export type BroadcastActionDockPhase = 'ready' | 'completed';
export type BroadcastActionTone = 'normal' | 'quiet' | 'danger';

export interface BroadcastDockAction {
  /** Stable id used for React keys and test selectors. */
  id: string;
  /** Visible button copy. Keep it short enough to read at broadcast distance. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Use when the visible copy alone does not fully describe the action. */
  ariaLabel?: string;
  /** Native tooltip for uncommon or destructive actions. */
  title?: string;
  /** Secondary actions default to `normal`; the primary always stays dominant. */
  tone?: BroadcastActionTone;
}

export interface BroadcastActionDockProps {
  phase: BroadcastActionDockPhase;
  primaryAction: BroadcastDockAction;
  /** Up to three supporting actions. The dock remains usable with none. */
  secondaryActions?: readonly BroadcastDockAction[];
  /** Concise commitment or completion context that must stay visible on air. */
  note: ReactNode;
  ariaLabel?: string;
  className?: string;
}

function actionClassName(kind: 'primary' | 'secondary', tone: BroadcastActionTone) {
  return [
    'broadcast-action-dock__button',
    `broadcast-action-dock__button--${kind}`,
    `broadcast-action-dock__button--${tone}`,
  ].join(' ');
}

/**
 * A phase-aware action hierarchy for the broadcast canvas.
 *
 * Result content stays outside this component so App can keep the winner board
 * before the controls in both visual and reading order.
 */
export default function BroadcastActionDock({
  phase,
  primaryAction,
  secondaryActions = [],
  note,
  ariaLabel = '추첨 동작',
  className,
}: BroadcastActionDockProps) {
  const noteId = useId();
  const dockClassName = [
    'broadcast-action-dock',
    `broadcast-action-dock--${phase}`,
    className,
  ].filter(Boolean).join(' ');
  const supportingActions = secondaryActions.slice(0, 3);

  const renderButton = (action: BroadcastDockAction, kind: 'primary' | 'secondary') => {
    const tone = kind === 'primary' ? 'normal' : (action.tone ?? 'normal');

    return (
      <button
        key={action.id}
        type="button"
        className={actionClassName(kind, tone)}
        onClick={action.onClick}
        disabled={action.disabled}
        aria-label={action.ariaLabel}
        aria-describedby={noteId}
        title={action.title}
        data-action-id={action.id}
      >
        {action.label}
      </button>
    );
  };

  return (
    <section className={dockClassName} aria-label={ariaLabel}>
      <p id={noteId} className="broadcast-action-dock__note">
        <span aria-hidden="true">●</span>
        <span>{note}</span>
      </p>

      <div className="broadcast-action-dock__controls">
        {renderButton(primaryAction, 'primary')}

        {supportingActions.length > 0 && (
          <div className="broadcast-action-dock__secondary" aria-label="추가 동작">
            {supportingActions.map((action) => renderButton(action, 'secondary'))}
          </div>
        )}
      </div>
    </section>
  );
}
