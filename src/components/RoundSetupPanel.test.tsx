import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Participant } from '../types';
import RoundSetupPanel, { type RoundSetupPanelProps } from './RoundSetupPanel';

const participants: Participant[] = [
  { id: 'a', name: '아모레또', weight: 1 },
  { id: 'b', name: '유레카', weight: 1 },
];

function renderPanel(overrides: Partial<RoundSetupPanelProps> = {}) {
  const noop = () => undefined;
  const props: RoundSetupPanelProps = {
    target: 'people',
    wheelPresentation: 'dart',
    participantTotal: participants.length,
    eligibleParticipants: participants,
    candidateParticipants: participants,
    drawOptionCount: participants.length,
    excludedCount: 0,
    poolLimit: 0,
    prizes: [],
    rewardLabel: '',
    drawLabel: '오늘의 선물 추첨',
    prizeRecipientText: '',
    prizeRecipientCount: 0,
    assignedPrizeRecipientCount: 0,
    prizeRecipientSource: 'manual',
    recentWinnerCount: 0,
    recentWinnersAlreadyLoaded: false,
    removeAfterDraw: true,
    useWeights: false,
    onTargetChange: noop,
    onRewardLabelChange: noop,
    onDrawLabelChange: noop,
    onPrizeRecipientTextChange: noop,
    onLoadRecentWinners: noop,
    onRestartPrizeRecipients: noop,
    onPoolLimitChange: noop,
    onReshufflePool: noop,
    onPresentationChange: noop,
    onRemoveAfterDrawChange: noop,
    onUseWeightsChange: noop,
    onParticipantWeightChange: noop,
    onEditRoster: noop,
    onRestoreExcluded: noop,
    onAddPrize: noop,
    onUpdatePrize: noop,
    onPrizeWeightChange: noop,
    onRemovePrize: noop,
    ...overrides,
  };

  return renderToStaticMarkup(<RoundSetupPanel {...props} />);
}

describe('RoundSetupPanel information order', () => {
  it.each(['people', 'prizes'] as const)('keeps the same five setup slots for %s draws', (target) => {
    const markup = renderPanel({ target });
    const slots = [...markup.matchAll(/data-setup-slot="([^"]+)"/g)].map((match) => match[1]);

    expect(slots).toEqual(['title', 'target', 'presentation', 'data', 'advanced']);
    expect(markup.match(/>방송 제목</g)).toHaveLength(1);
  });

  it('uses the prize data slot for an explicit recipient roster and product editor', () => {
    const peopleMarkup = renderPanel({ target: 'people' });
    const prizeMarkup = renderPanel({
      target: 'prizes',
      prizeRecipientText: '아모레또\n유레카\n아모레또',
      prizeRecipientCount: 3,
      assignedPrizeRecipientCount: 1,
      prizeRecipientSource: 'linked',
      recentWinnerCount: 3,
    });

    expect(peopleMarkup).toContain('round-setup__data-slot round-setup__data-slot--people');
    expect(peopleMarkup).toContain('data-setup-data-layout="span"');
    expect(peopleMarkup).toContain('round-setup__row--source-spanning');
    expect(peopleMarkup).not.toContain('round-setup__prizes');
    expect(peopleMarkup).toContain('>상품명 <');

    expect(prizeMarkup).toContain('round-setup__data-slot round-setup__data-slot--prizes');
    expect(prizeMarkup).toContain('data-setup-data-layout="split"');
    expect(prizeMarkup).toContain('round-setup__prizes');
    expect(prizeMarkup.indexOf('round-setup__row--source')).toBeLessThan(prizeMarkup.indexOf('round-setup__prizes'));
    expect(prizeMarkup).toContain('>받을 사람<');
    expect(prizeMarkup).toContain('aria-label="상품 받을 사람 명단"');
    expect(prizeMarkup).toContain('아모레또\n유레카\n아모레또');
    expect(prizeMarkup).toContain('3명 · 이전 당첨자 연동 · 1/3 배정 · 명단 잠김');
    expect(prizeMarkup).toMatch(/<textarea[^>]*disabled=""[^>]*aria-label="상품 받을 사람 명단"/);
    expect(prizeMarkup).toContain('>이전 당첨자</span><strong>3명으로 교체</strong>');
    expect(prizeMarkup).toContain('같은 명단으로 새 배정');
    expect(prizeMarkup.indexOf('>받을 사람<')).toBeLessThan(prizeMarkup.indexOf('<details'));
    expect(prizeMarkup).not.toContain('받을 사람 <em>선택</em>');
  });

  it('makes direct entry and product-only mode explicit without prior winners', () => {
    const markup = renderPanel({ target: 'prizes' });

    expect(markup).toContain('placeholder="직접 입력 · 한 줄에 한 명"');
    expect(markup).toContain('상품만 추첨');
    expect(markup).toContain('>이전 당첨자</span><strong>없음</strong>');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('수량 비율 · 재고 차감');
  });

  it('makes a loaded previous-winner roster explicit and non-destructive', () => {
    const markup = renderPanel({
      target: 'prizes',
      prizeRecipientText: '아모레또\n유레카',
      prizeRecipientCount: 2,
      prizeRecipientSource: 'linked',
      recentWinnerCount: 2,
      recentWinnersAlreadyLoaded: true,
      recentWinnerLabel: '오늘의 당첨자 추첨',
    });

    expect(markup).toContain('>이전 당첨자</span><strong>연동됨</strong>');
    expect(markup).toContain('title="오늘의 당첨자 추첨 · 2명"');
  });
});
