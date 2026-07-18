import { useEffect, useId, useRef } from 'react';

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
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollTargetRef = useRef<HTMLLIElement>(null);
  const previousWinnerCountRef = useRef(0);
  const requestedCount = normalizedCount(drawCount, winners.length);
  const count = Math.max(requestedCount, winners.length);
  const pendingCount = count - winners.length;
  const latestIndex = latestWinnerId
    ? winners.findIndex((winner) => winner.id === latestWinnerId)
    : -1;
  const scrollTargetIndex = latestIndex >= 0 ? latestIndex : winners.length - 1;
  const isComplete = winners.length > 0 && pendingCount === 0;
  const useTwoColumns = winners.length >= 6 && winners.length <= 10;
  const boardClassName = [
    'current-round-winners',
    winners.length === 0 ? 'is-empty' : undefined,
    isComplete ? 'is-complete' : undefined,
    className,
  ].filter(Boolean).join(' ');
  const unitSubjectParticle = unit === '명' ? '이' : '가';
  const announcementText = announcement ?? (winners.length > 0 ? `이번 추첨 당첨자 ${winners.length}${unit}${unitSubjectParticle} 발표되었습니다.` : undefined);
  const eyebrow = winners.length === 0
    ? '🍸 추첨 준비'
    : isComplete
      ? '🎉 추첨 완료'
      : `🎉 ${winners.length}${unit} 발표`;

  useEffect(() => {
    const didAppend = winners.length > previousWinnerCountRef.current;
    previousWinnerCountRef.current = winners.length;
    if (!didAppend) return;

    const body = bodyRef.current;
    const target = scrollTargetRef.current;
    if (!body || !target) return;

    const frame = window.requestAnimationFrame(() => {
      const bodyBounds = body.getBoundingClientRect();
      const targetBounds = target.getBoundingClientRect();
      let nextScrollTop: number | undefined;

      if (targetBounds.bottom > bodyBounds.bottom) {
        nextScrollTop = body.scrollTop + targetBounds.bottom - bodyBounds.bottom + 6;
      } else if (targetBounds.top < bodyBounds.top) {
        nextScrollTop = body.scrollTop - (bodyBounds.top - targetBounds.top) - 6;
      }

      if (nextScrollTop === undefined) return;
      const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

      if (typeof body.scrollTo === 'function') {
        body.scrollTo({ top: Math.max(0, nextScrollTop), behavior });
      } else {
        body.scrollTop = Math.max(0, nextScrollTop);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [latestWinnerId, winners.length]);

  return (
    <section className={boardClassName} aria-labelledby={headingId}>
      {announcementText && (
        <p className="current-round-winners__announcement" role="status" aria-live="polite" aria-atomic="true">
          {announcementText}
        </p>
      )}

      <header className="current-round-winners__header">
        <div>
          <p className="current-round-winners__eyebrow" aria-hidden="true">{eyebrow}</p>
          <h2 id={headingId}>{title}</h2>
        </div>
        <span
          className="current-round-winners__count"
          aria-label={winners.length > 0
            ? `전체 ${count}${unit} 중 ${winners.length}${unit} 발표`
            : `전체 ${count}${unit} 중 아직 발표된 당첨자 없음`}
        >
          {winners.length}/{count}
        </span>
      </header>

      <div className="current-round-winners__body" ref={bodyRef}>
        {winners.length === 0 ? (
          <div className="current-round-winners__empty">
            <span className="current-round-winners__empty-mark" aria-hidden="true">🍸</span>
            <strong>아직 당첨자가 없습니다</strong>
            <small>
              {count > 0
                ? `추첨을 시작하면 ${count}${unit}의 결과가 순서대로 표시됩니다.`
                : '추첨을 시작하면 결과가 순서대로 표시됩니다.'}
            </small>
          </div>
        ) : (
          <ol
            className={`current-round-winners__list${useTwoColumns ? ' current-round-winners__list--two-column' : ''}`}
            aria-label={`${title} · 전체 ${count}${unit} 중 ${winners.length}${unit} 발표`}
          >
            {winners.map((winner, index) => {
              const isLatest = index === latestIndex;
              const isScrollTarget = index === scrollTargetIndex;
              const name = winner.name.trim() || '이름 없음';

              return (
                <li
                  key={itemKey(winner, index)}
                  ref={isScrollTarget ? scrollTargetRef : undefined}
                  className={isLatest ? 'is-latest' : undefined}
                  aria-current={isLatest ? 'true' : undefined}
                >
                  <span className="current-round-winners__number" aria-hidden="true">{index + 1}</span>
                  <span className="current-round-winners__identity">
                    <strong>{name}</strong>
                    {winner.detail && <small>{winner.detail}</small>}
                  </span>
                  <span className="current-round-winners__state">
                    {isLatest ? (isComplete ? '마지막 당첨' : '방금 당첨') : '당첨'}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {winners.length > 0 && pendingCount > 0 ? (
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
        ) : null}
      </div>

      {removalMessage && winners.length > 0 && <p className="current-round-winners__removal">{removalMessage}</p>}
    </section>
  );
}
