import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CurrentRoundWinners from './CurrentRoundWinners';

describe('CurrentRoundWinners visible cumulative count', () => {
  it.each([
    ['명', '누적 3명'],
    ['개', '누적 3개'],
  ])('shows the visible cumulative %s count only in the right badge', (unit, countLabel) => {
    const markup = renderToStaticMarkup(
      <CurrentRoundWinners
        winners={[
          { id: '1', name: '아모레또' },
          { id: '2', name: '유레카' },
          { id: '3', name: '세나' },
        ]}
        unit={unit}
      />,
    );

    expect(markup.match(new RegExp(`>${countLabel}<`, 'g'))).toHaveLength(1);
    expect(markup).toContain('current-round-winners__count');
    expect(markup).toContain('🎉 방송 결과');
    expect(markup).not.toContain(`current-round-winners__eyebrow\">🎉 ${countLabel}`);
  });

  it('keeps short names readable and marks long one-line names for compact overflow', () => {
    const markup = renderToStaticMarkup(
      <CurrentRoundWinners
        winners={[
          { id: '1', name: '여덟글자이름맞아' },
          { id: '2', name: '아주아주긴당첨자이름입니다' },
        ]}
      />,
    );

    expect(markup.match(/current-round-winners__name--compact/g)).toHaveLength(2);
    expect(markup).toContain('title="여덟글자이름맞아"');
    expect(markup).toContain('title="아주아주긴당첨자이름입니다"');
  });

  it('keeps a single-column board when the cumulative list grows', () => {
    const markup = renderToStaticMarkup(
      <CurrentRoundWinners
        winners={Array.from({ length: 8 }, (_, index) => ({
          id: String(index),
          name: `당첨자${index + 1}`,
        }))}
      />,
    );

    expect(markup).toContain('class="current-round-winners__list"');
    expect(markup).not.toContain('current-round-winners__list--two-column');
    expect(markup.match(/current-round-winners__state/g)).toHaveLength(8);
  });
});
