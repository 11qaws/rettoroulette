import { useEffect, useId, useState } from 'react';

import './WinnerHero.css';

export interface WinnerHeroProps {
  /** The confirmed result to reveal. Names wrap in full and are never truncated. */
  winnerName: string;
  /** The one-based place currently being revealed in a multi-result draw. */
  ordinal?: number;
  /** The total number of results planned for this draw. */
  total?: number;
  /** Short result type shown above the name, for example "당첨자" or "뽑힌 상품". */
  targetLabel?: string;
  /** Optional person receiving the result, useful when the roulette selects a product. */
  recipient?: string;
  /** Optional product matched to this result. */
  product?: string;
  /** Overrides the concise assistive-technology announcement. */
  announcement?: string;
  /** Lets the broadcast stage add a layout-specific class without changing this skin. */
  className?: string;
}

function positiveInteger(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return undefined;
  return Math.floor(value);
}

function buildAnnouncement({
  winnerName,
  ordinal,
  total,
  targetLabel,
  recipient,
  product,
}: Omit<WinnerHeroProps, 'announcement' | 'className'>) {
  const details = [
    product ? `상품 ${product}` : undefined,
    recipient ? `받는 분 ${recipient}` : undefined,
    ordinal && total ? `${total}개 결과 중 ${ordinal}번째` : ordinal ? `${ordinal}번째 결과` : undefined,
  ].filter(Boolean);

  return `${targetLabel ?? '당첨'}: ${winnerName}.${details.length > 0 ? ` ${details.join('. ')}.` : ''}`;
}

/**
 * Broadcast-safe winner reveal shown only after the physical roulette has stopped.
 *
 * The live region starts empty and is populated on the next frame. This keeps the
 * visible presentation fully accessible while announcing one concise result rather
 * than every decorative word and emoji in the hero.
 */
export default function WinnerHero({
  winnerName,
  ordinal,
  total,
  targetLabel = '당첨!',
  recipient,
  product,
  announcement,
  className,
}: WinnerHeroProps) {
  const headingId = useId();
  const [liveMessage, setLiveMessage] = useState('');
  const name = winnerName.trim() || '이름 없음';
  const currentOrdinal = positiveInteger(ordinal);
  const requestedTotal = positiveInteger(total);
  const resultTotal = requestedTotal && currentOrdinal
    ? Math.max(requestedTotal, currentOrdinal)
    : requestedTotal;
  const resultCount = currentOrdinal && resultTotal
    ? `${currentOrdinal} / ${resultTotal}`
    : currentOrdinal
      ? `${currentOrdinal}번째`
      : resultTotal
        ? `총 ${resultTotal}`
        : undefined;
  const announcementText = announcement ?? buildAnnouncement({
    winnerName: name,
    ordinal: currentOrdinal,
    total: resultTotal,
    targetLabel,
    recipient,
    product,
  });
  const rootClassName = [
    'winner-hero',
    name.length > 24 ? 'is-very-long-name' : name.length > 14 ? 'is-long-name' : undefined,
    className,
  ].filter(Boolean).join(' ');

  useEffect(() => {
    setLiveMessage('');
    const frame = window.requestAnimationFrame(() => setLiveMessage(announcementText));
    return () => window.cancelAnimationFrame(frame);
  }, [announcementText]);

  return (
    <section className={rootClassName} aria-labelledby={headingId}>
      <p className="winner-hero__announcement" role="status" aria-atomic="true">
        {liveMessage}
      </p>

      <div className="winner-hero__burst" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="winner-hero__card">
        <p className="winner-hero__brand" aria-hidden="true">
          <span>🍸</span>
          <b>RETTO ROULETTE</b>
          <span>💝</span>
        </p>

        <div className="winner-hero__result-heading">
          <p className="winner-hero__target">{targetLabel}</p>
          {resultCount && (
            <p className="winner-hero__count" aria-label={`추첨 순서 ${resultCount}`}>
              {resultCount}
            </p>
          )}
        </div>

        <h2 id={headingId} className="winner-hero__name">{name}</h2>

        {(product || recipient) && (
          <dl className="winner-hero__details">
            {product && (
              <div>
                <dt>상품</dt>
                <dd>{product}</dd>
              </div>
            )}
            {recipient && (
              <div>
                <dt>받는 분</dt>
                <dd>{recipient}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </section>
  );
}
