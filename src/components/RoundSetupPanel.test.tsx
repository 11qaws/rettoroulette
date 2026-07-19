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
  it('keeps title, target, presentation and roster in the requested primary order', () => {
    const markup = renderPanel();
    const title = markup.indexOf('round-setup__row--title');
    const target = markup.indexOf('round-setup__row--target');
    const presentation = markup.indexOf('round-setup__row--presentation');
    const roster = markup.indexOf('round-setup__row--source');
    const advanced = markup.indexOf('round-setup__advanced');

    expect(title).toBeGreaterThanOrEqual(0);
    expect(title).toBeLessThan(target);
    expect(target).toBeLessThan(presentation);
    expect(presentation).toBeLessThan(roster);
    expect(roster).toBeLessThan(advanced);
    expect(markup.match(/>방송 제목</g)).toHaveLength(1);
    expect(markup).toContain('>상품명 <');
  });

  it('keeps the prize recipient field in advanced settings', () => {
    const markup = renderPanel({ target: 'prizes' });

    expect(markup).toContain('>받을 사람 <');
    expect(markup.match(/>방송 제목</g)).toHaveLength(1);
  });
});
