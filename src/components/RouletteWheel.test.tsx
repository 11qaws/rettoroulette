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

  it('publishes stable slice and palette indices for visual impact verification', () => {
    const markup = renderToStaticMarkup(
      <RouletteWheel
        participants={['아모레또', '유레카', '세나']}
        winnerIndex={null}
        spinning={false}
        spinKey={0}
        presentation="dart"
        onSpinEnd={() => undefined}
      />,
    );

    expect(markup).toContain('data-slice-index="0"');
    expect(markup).toContain('data-slice-index="1"');
    expect(markup).toContain('data-slice-index="2"');
    expect(markup).toContain('data-slice-color="var(--hot-pink, #ffb6c1)"');
    expect(markup).toContain('data-slice-color="var(--lemon, #ffd166)"');
    expect(markup).toContain('data-slice-color="var(--mint, #34e0a8)"');
  });

  it('publishes the click-time pointer footprint beside the explicit selection anchor', () => {
    const markup = renderToStaticMarkup(
      <RouletteWheel
        participants={['아모레또', '유레카', '세나']}
        winnerIndex={1}
        spinning
        spinKey={1}
        spinCommit={{
          capturedRotation: 100,
          angularVelocity: 1_080,
          plannedTravelDegrees: 1_440,
          stopRotation: 1_540,
          geometrySignature: '0.333333333333|0.333333333333|0.333333333333',
          winnerIndex: 1,
          boundaryToleranceDegrees: 0.8615,
          landing: {
            kind: 'interior',
            positionRatio: 0.5,
            entryGapDegrees: 12,
            leadDegrees: 12,
            boundaryHit: false,
          },
        }}
        onSpinEnd={() => undefined}
      />,
    );

    expect(markup).toContain('data-boundary-tolerance="0.8615"');
    expect(markup).toContain('class="roulette-wheel__selection-anchor"');
  });
});
