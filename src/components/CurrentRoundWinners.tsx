import { useId } from 'react';

import './CurrentRoundWinners.css';

export type CurrentRoundWinner = {
  /** Stable when available so the newest winner can be highlighted reliably. */
  id?: string;
  /** The name shown on the broadcast screen. Names always wrap; none are truncated. */
  name: string;
  /** Optional short context, for example the matched prize name. */
  detail?: string;
};

export interface CurrentRoundWinnersProps {
  /** Every winner from the completed current draw, in draw order. */
  winners: readonly CurrentRoundWinner[];
  /** Number requested for this draw. Defaults to the number of supplied winners. */
  drawCount?: number;
  /** Shown beneath the list, for example the duplicate-winner removal policy. */
  removalMessage?: string;
  /** Highlights this winner while a multi-winner draw is still being revealed. */
  latestWinnerId?: string;
  /** Lets a prize draw use a more specific board title without changing the layout. */
  title?: string;
  /** Optional concise text announced once to assistive technology. */
  announcement?: string;
  className?: string;
}

function normalizedCount(drawCount: number | undefined, fallback: number) {
  if (typeof drawCount !== 'number' || !Number.isFinite(drawCount)) return fallback;
  return Math.max(0, Math.floor(drawCount));
}

function itemKey(winner: CurrentRoundWinner, index: number) {
  return winner.id ?? `${winner.name}-${index}`;
}

/**
 * A persistent broadcast board for the winners from one completed draw.
 *
 * This deliberately renders the complete array with wrapping names instead of
 * slicing or ellipsizing it: everyone watching can verify every winner.
 */
export default function CurrentRoundWinners({
  winners,
  drawCount,
  removalMessage,
  latestWinnerId,
  title = '이번 룰렛 당첨자',
  announcement,
  className,
}: CurrentRoundWinnersProps) {
  const headingId = useId();
  const count = normalizedCount(drawCount, winners.length);
  const latestIndex = latestWinnerId
    ? winners.findIndex((winner) => winner.id === latestWinnerId)
    : -1;
  const boardClassName = ['current-round-winners', className].filter(Boolean).join(' ');
  const announcementText = announcement ?? (winners.length > 0 ? `이번 추첨 당첨자 ${winners.length}명이 발표되었습니다.` : undefined);
  const slots = Array.from({ length: Math.max(count, winners.length) }, (_, index) => winners[index]);

  return (
    <section className={boardClassName} aria-labelledby={headingId}>
      {announcementText && (
        <p className="current-round-winners__announcement" role="status" aria-live="polite" aria-atomic="true">
          {announcementText}
        </p>
      )}

      <header className="current-round-winners__header">
        <div>
          <p className="current-round-winners__eyebrow" aria-hidden="true">🎉 이번 추첨</p>
          <h2 id={headingId}>{title}</h2>
        </div>
        <span className="current-round-winners__count" aria-label={`당첨자 ${winners.length}명 중 ${count}명`}>
          {winners.length}/{count}
        </span>
      </header>

      <ol className="current-round-winners__list" aria-label={`${title} ${count}명 목록`}>
        {slots.map((winner, index) => {
          if (!winner) {
            return (
              <li key={`pending-${index}`} className="is-pending">
                <span className="current-round-winners__number" aria-hidden="true">{index + 1}</span>
                <span className="current-round-winners__identity">
                  <strong>추첨 대기</strong>
                </span>
                <span className="current-round-winners__state">대기</span>
              </li>
            );
          }

          const isLatest = index === latestIndex;
          const name = winner.name.trim() || '이름 없음';

          return (
            <li key={itemKey(winner, index)} className={isLatest ? 'is-latest' : undefined}>
              <span className="current-round-winners__number" aria-hidden="true">{index + 1}</span>
              <span className="current-round-winners__identity">
                <strong>{name}</strong>
                {winner.detail && <small>{winner.detail}</small>}
              </span>
              <span className="current-round-winners__state">{isLatest ? '방금 당첨' : '당첨'}</span>
            </li>
          );
        })}
      </ol>

      {removalMessage && winners.length > 0 && <p className="current-round-winners__removal">{removalMessage}</p>}
    </section>
  );
}
