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
});
