import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import DartFinish, { BoundaryNames, isDartBoundaryPhaseVisible } from './DartFinish';

describe('DartFinish', () => {
  it('uses one continuous flight phase on one shared impact anchor', () => {
    const markup = renderToStaticMarkup(<DartFinish phase="flight" />);

    expect(markup).toContain('dart-finish--flight');
    expect(markup).toContain('--dart-flight-duration:1.15s');
    expect(markup).toContain('dart-finish__impact-anchor');
    expect(markup).not.toContain('dart-finish--launch');
    expect(markup).not.toContain('dart-finish--approach');
  });
});

describe('BoundaryNames', () => {
  it('renders explicit physical left and right candidates', () => {
    const markup = renderToStaticMarkup(
      <BoundaryNames
        leftName="왼쪽 후보"
        rightName="오른쪽 후보"
        leftColor="#ffd166"
        rightColor="#ffb6c1"
        visible
        mode="spin"
      />,
    );

    expect(markup.indexOf('왼쪽 후보')).toBeLessThan(markup.indexOf('경계'));
    expect(markup.indexOf('경계')).toBeLessThan(markup.indexOf('오른쪽 후보'));
    expect(markup).toContain('boundary-names__candidate--left');
    expect(markup).toContain('boundary-names__candidate--right');
  });

  it('marks only the proven winner side after the stop', () => {
    const markup = renderToStaticMarkup(
      <BoundaryNames
        leftName="이웃 후보"
        rightName="당첨자"
        leftColor="#ffd166"
        rightColor="#ffb6c1"
        visible
        mode="dart"
        winnerSide="right"
      />,
    );

    expect(markup).toContain('boundary-names__candidate--right is-winner');
    expect(markup).not.toContain('boundary-names__candidate--left is-winner');
  });

  it('keeps names hidden while preserving candidate colour cards', () => {
    const markup = renderToStaticMarkup(
      <BoundaryNames
        leftName="왼쪽 후보"
        rightName="오른쪽 후보"
        leftColor="#ffd166"
        rightColor="#ffb6c1"
        visible
        namesVisible={false}
        mode="dart"
      />,
    );

    expect(markup).toContain('is-colors-only');
    expect(markup).toContain('boundary-names__text');
  });

  it('moves to the final proof point without declaring a winner early', () => {
    const markup = renderToStaticMarkup(
      <BoundaryNames
        leftName="left"
        rightName="right"
        leftColor="#ffd166"
        rightColor="#ffb6c1"
        visible
        finalPoint
        mode="dart"
      />,
    );

    expect(markup).toContain('is-final-point');
    expect(markup).not.toContain('is-final ');
    expect(markup).not.toContain('is-winner');
  });

  it('allows the full dart boundary proof only during the final one-second coast', () => {
    expect(isDartBoundaryPhaseVisible('idle')).toBe(false);
    expect(isDartBoundaryPhaseVisible('flight')).toBe(false);
    expect(isDartBoundaryPhaseVisible('impact')).toBe(false);
    expect(isDartBoundaryPhaseVisible('coast')).toBe(true);
    expect(isDartBoundaryPhaseVisible('settled')).toBe(true);
  });
});
