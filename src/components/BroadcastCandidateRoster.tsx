import { useId } from 'react';
import type { CSSProperties } from 'react';

import './BroadcastCandidateRoster.css';

type CandidateRosterStyle = CSSProperties & {
  '--candidate-loop-duration': string;
};

export interface BroadcastCandidateRosterProps {
  items: readonly string[];
  title: string;
  unit: string;
}

export function candidateLoopDurationSeconds(itemCount: number) {
  return Math.max(32, Math.max(0, itemCount) * 3);
}

function CandidateList({ items, clone = false }: { items: readonly string[]; clone?: boolean }) {
  return (
    <ol className="broadcast-candidate-roster__list" aria-hidden={clone || undefined}>
      {items.map((item, index) => (
        <li key={`${clone ? 'clone' : 'source'}-${index}-${item}`}>
          <span className="broadcast-candidate-roster__number" aria-hidden="true">{index + 1}</span>
          <strong title={item}>{item}</strong>
        </li>
      ))}
    </ol>
  );
}

/** Read-only on-air proof of the exact option snapshot currently drawn on the wheel. */
export default function BroadcastCandidateRoster({ items, title, unit }: BroadcastCandidateRosterProps) {
  const titleId = useId();
  const names = items.map((item) => item.trim() || '이름 없음');
  const looping = names.length > 10;
  const style: CandidateRosterStyle = {
    '--candidate-loop-duration': `${candidateLoopDurationSeconds(names.length)}s`,
  };
  const className = [
    'broadcast-candidate-roster',
    looping ? 'is-looping' : '',
    names.length === 0 ? 'is-empty' : '',
  ].filter(Boolean).join(' ');

  return (
    <aside className={className} aria-labelledby={titleId}>
      <header className="broadcast-candidate-roster__header">
        <h2 id={titleId}>{title}</h2>
        <span>{names.length}{unit}</span>
      </header>

      {names.length === 0 ? (
        <p className="broadcast-candidate-roster__empty">후보를 준비해 주세요</p>
      ) : (
        <div
          className="broadcast-candidate-roster__viewport"
          tabIndex={looping ? 0 : undefined}
          aria-label={`${title} ${names.length}${unit}${looping ? ' · 자동 스크롤' : ''}`}
        >
          <div className="broadcast-candidate-roster__track" style={style}>
            <CandidateList items={names} />
            {looping && <CandidateList items={names} clone />}
          </div>
        </div>
      )}
    </aside>
  );
}
