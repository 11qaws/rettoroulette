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
    recipient: '',
    removeAfterDraw: true,
    useWeights: false,
    onTargetChange: noop,
    onRewardLabelChange: noop,
    onDrawLabelChange: noop,
    onRecipientChange: noop,
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

  it('lets the people roster span the data slot used by the two prize rows', () => {
    const peopleMarkup = renderPanel({ target: 'people' });
    const prizeMarkup = renderPanel({ target: 'prizes' });

    expect(peopleMarkup).toContain('round-setup__data-slot round-setup__data-slot--people');
    expect(peopleMarkup).toContain('data-setup-data-layout="span"');
    expect(peopleMarkup).toContain('round-setup__row--source-spanning');
    expect(peopleMarkup).not.toContain('round-setup__prizes');
    expect(peopleMarkup).toContain('>상품명 <');

    expect(prizeMarkup).toContain('round-setup__data-slot round-setup__data-slot--prizes');
    expect(prizeMarkup).toContain('data-setup-data-layout="split"');
    expect(prizeMarkup).toContain('round-setup__prizes');
    expect(prizeMarkup.indexOf('round-setup__row--source')).toBeLessThan(prizeMarkup.indexOf('round-setup__prizes'));
    expect(prizeMarkup).toContain('>받을 사람 <');
  });
});
