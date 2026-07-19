import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import BroadcastCandidateRoster, { candidateLoopDurationSeconds } from './BroadcastCandidateRoster';

const names = Array.from({ length: 11 }, (_, index) => `참여자 ${index + 1}`);

describe('BroadcastCandidateRoster', () => {
  it('keeps ten candidates static without a duplicate track', () => {
    const markup = renderToStaticMarkup(
      <BroadcastCandidateRoster items={names.slice(0, 10)} title="참여자 명단" unit="명" />,
    );

    expect(markup).not.toContain('is-looping');
    expect(markup.match(/broadcast-candidate-roster__list/g)).toHaveLength(1);
    expect(markup).toContain('10명');
  });

  it('loops only above ten and hides the visual clone from assistive technology', () => {
    const markup = renderToStaticMarkup(
      <BroadcastCandidateRoster items={names} title="참여자 명단" unit="명" />,
    );

    expect(markup).toContain('broadcast-candidate-roster is-looping');
    expect(markup.match(/broadcast-candidate-roster__list/g)).toHaveLength(2);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('자동 스크롤');
    expect(markup).toContain('--candidate-loop-duration:33s');
  });

  it('scales the loop duration with larger rosters', () => {
    expect(candidateLoopDurationSeconds(11)).toBe(33);
    expect(candidateLoopDurationSeconds(20)).toBe(60);
  });

  it('preserves repeated prize inventory units instead of deduplicating them', () => {
    const markup = renderToStaticMarkup(
      <BroadcastCandidateRoster items={Array(11).fill('버거')} title="추첨 상품" unit="개" />,
    );

    expect(markup).toContain('11개');
    expect(markup.match(/<strong title="버거">버거<\/strong>/g)).toHaveLength(22);
  });
});
