import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import DartFinish, {
  BoundaryNames,
  EmbeddedDart,
  isDartBoundaryPhaseVisible,
  WinnerNameplate,
} from './DartFinish';

describe('DartFinish', () => {
  it('uses one continuous flight phase on one shared impact anchor', () => {
    const markup = renderToStaticMarkup(<DartFinish phase="flight" />);

    expect(markup).toContain('dart-finish--flight');
    expect(markup).toContain('--dart-flight-duration:1.15s');
    expect(markup).toContain('dart-finish__impact-anchor');
    expect(markup).not.toContain('dart-finish--launch');
    expect(markup).not.toContain('dart-finish--approach');
    expect(markup).toContain('dart-glyph__shaft');
    expect(markup).toContain('dart-glyph__contact-tip');
    expect(markup).toContain('data-dart-contact-point="screen"');
    expect(markup).not.toContain('경계선!');
  });

  it('uses the same dart silhouette after impact', () => {
    const markup = renderToStaticMarkup(<EmbeddedDart phase="impact" impactRotation={320} />);

    expect(markup).toContain('embedded-dart--impact');
    expect(markup).toContain('dart-glyph__shaft');
    expect(markup).toContain('dart-glyph__contact-tip');
    expect(markup).toContain('data-dart-contact-point="board"');
    expect(markup).not.toContain('embedded-dart-contact-proof');
  });

  it('exposes exactly one canonical contact point in each dart coordinate space', () => {
    const flightMarkup = renderToStaticMarkup(<DartFinish phase="flight" />);
    const embeddedMarkup = renderToStaticMarkup(
      <EmbeddedDart phase="impact" impactRotation={0} />,
    );

    expect(flightMarkup.match(/data-dart-contact-point=/g)).toHaveLength(1);
    expect(embeddedMarkup.match(/data-dart-contact-point=/g)).toHaveLength(1);
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
    expect(markup).toContain('WIN!');
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

  it('preserves eight graphemes and compacts longer boundary names to one eight-slot label', () => {
    const markup = renderToStaticMarkup(
      <BoundaryNames
        leftName="여덟글자이름맞아"
        rightName="아주아주긴당첨자이름입니다"
        leftColor="#ffd166"
        rightColor="#ffb6c1"
        visible
        mode="spin"
      />,
    );

    expect(markup).toContain('boundary-names__text boundary-names__text--compact');
    expect(markup).toContain('title="여덟글자이름맞아">여덟글자이름맞아</span>');
    expect(markup).toContain('boundary-names__text--compact is-truncated');
    expect(markup).toContain('title="아주아주긴당첨자이름입니다">아주아주긴당첨…</span>');
    expect(markup).not.toContain('>아주아주긴당첨자이름입니다</span>');
  });

  it('does not split a composed emoji while shortening a proof nickname', () => {
    const markup = renderToStaticMarkup(
      <WinnerNameplate name="가나다라마바사👩‍💻추가" color="#ffb6c1" visible mode="dart" />,
    );

    expect(markup).toContain('title="가나다라마바사👩‍💻추가">가나다라마바사…</span>');
  });
});

describe('WinnerNameplate', () => {
  it('uses the same winner card language for a non-boundary stop', () => {
    const markup = renderToStaticMarkup(
      <WinnerNameplate name="아모레또" color="#ffb6c1" visible mode="spin" />,
    );

    expect(markup).toContain('winner-nameplate--spin is-visible');
    expect(markup).toContain('boundary-names__candidate is-winner');
    expect(markup).toContain('WIN!');
    expect(markup).toContain('아모레또');
  });

  it('does not keep a hidden WIN panel mounted before physical proof', () => {
    const markup = renderToStaticMarkup(
      <WinnerNameplate name="아모레또" color="#ffb6c1" visible={false} mode="spin" />,
    );

    expect(markup).toBe('');
    expect(markup).not.toContain('WIN!');
  });

  it.each(['spin', 'dart'] as const)('uses the same compact nickname proof in %s mode', (mode) => {
    const markup = renderToStaticMarkup(
      <WinnerNameplate name="아주아주긴당첨자이름입니다" color="#ffb6c1" visible mode={mode} />,
    );

    expect(markup).toContain(`winner-nameplate--${mode} is-visible`);
    expect(markup).toContain('boundary-names__text--compact is-truncated');
    expect(markup).toContain('>아주아주긴당첨…</span>');
  });
});
