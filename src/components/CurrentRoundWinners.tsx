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
  /** Visible unit for the result target, for example 명 or 개. */
  unit?: string;
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
 * The complete revealed-winner array is always rendered in draw order. Pending
 * places are intentionally represented by one summary instead of dozens of
 * empty rows, so a large planned draw never changes the broadcast layout.
 */
export default function CurrentRoundWinners({
  winners,
  drawCount,
  unit = '명',
  removalMessage,
  latestWinnerId,
  title = '이번 룰렛 당첨자',
  announcement,
  className,
}: CurrentRoundWinnersProps) {
  const headingId = useId();
  const requestedCount = normalizedCount(drawCount, winners.length);
  const count = Math.max(requestedCount, winners.length);
  const pendingCount = count - winners.length;
  const latestIndex = latestWinnerId
    ? winners.findIndex((winner) => winner.id === latestWinnerId)
    : -1;
  const boardClassName = ['current-round-winners', className].filter(Boolean).join(' ');
  const unitSubjectParticle = unit === '명' ? '이' : '가';
  const announcementText = announcement ?? (winners.length > 0 ? `이번 추첨 당첨자 ${winners.length}${unit}${unitSubjectParticle} 발표되었습니다.` : undefined);

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
        <span className="current-round-winners__count" aria-label={`당첨 ${winners.length}${unit} 중 ${count}${unit}`}>
          {winners.length}/{count}
        </span>
      </header>

      <div className="current-round-winners__body">
        <ol className="current-round-winners__list" aria-label={`${title} · 발표된 당첨 ${winners.length}${unit}`}>
          {winners.map((winner, index) => {
            const isLatest = index === latestIndex;
            const name = winner.name.trim() || '이름 없음';

            return (
              <li
                key={itemKey(winner, index)}
                className={isLatest ? 'is-latest' : undefined}
                aria-current={isLatest ? 'true' : undefined}
              >
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

        {pendingCount > 0 ? (
          <p
            className="current-round-winners__pending-summary"
            aria-label={`아직 추첨되지 않은 ${pendingCount}${unit}`}
          >
            <span className="current-round-winners__pending-icon" aria-hidden="true">…</span>
            <span>
              <strong>추첨 대기</strong>
              <small>아직 {pendingCount}{unit} 남았어요</small>
            </span>
            <b aria-hidden="true">+{pendingCount}</b>
          </p>
        ) : winners.length === 0 ? (
          <p className="current-round-winners__empty">추첨을 시작하면 이곳에 순서대로 기록됩니다.</p>
        ) : null}
      </div>

      {removalMessage && winners.length > 0 && <p className="current-round-winners__removal">{removalMessage}</p>}
    </section>
  );
}
