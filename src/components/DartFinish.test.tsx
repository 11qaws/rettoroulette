import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BoundaryNames } from './DartFinish';

describe('BoundaryNames', () => {
  it('renders the winner on the visual left and the approaching neighbour on the right', () => {
    const markup = renderToStaticMarkup(
      <BoundaryNames
        beforeName="이웃 후보"
        afterName="당첨자"
        beforeColor="#ffd166"
        afterColor="#ffb6c1"
        visible
        mode="spin"
      />,
    );

    expect(markup.indexOf('당첨자')).toBeLessThan(markup.indexOf('경계'));
    expect(markup.indexOf('경계')).toBeLessThan(markup.indexOf('이웃 후보'));
    expect(markup).toContain('boundary-names__candidate--after');
    expect(markup).toContain('boundary-names__candidate--before');
  });
});
