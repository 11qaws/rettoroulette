import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import RouletteWheel from './RouletteWheel';

describe('RouletteWheel timing contract', () => {
  it('publishes every physical duration on the state root so the disc can inherit it', () => {
    const markup = renderToStaticMarkup(
      <RouletteWheel
        participants={['아모레또', '유레카', '세나']}
        winnerIndex={null}
        spinning={false}
        spinKey={0}
        onSpinEnd={() => undefined}
      />,
    );
    const rootTag = markup.slice(0, markup.indexOf('>') + 1);

    expect(rootTag).toContain('--wheel-auto-whirl-duration:4.2s');
    expect(rootTag).toContain('--wheel-photo-finish-duration:1.55s');
    expect(rootTag).toContain('--wheel-dart-flight-duration:1.15s');
    expect(rootTag).toContain('--wheel-post-impact-duration:1.55s');
    expect(rootTag).not.toContain('--wheel-rotation');
    expect(markup).toContain('class="roulette-wheel__disc" style="--wheel-rotation:0deg"');
  });
});
