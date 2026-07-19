import { describe, expect, it } from 'vitest';

import { derivePreparationReadiness, type PreparationInput } from './preparation';

const BASE: PreparationInput = {
  target: 'people',
  participantTotal: 8,
  eligibleParticipantCount: 8,
  candidateParticipantCount: 8,
  excludedParticipantCount: 0,
  poolLimit: 0,
  prizeInventoryCount: 0,
  prizeRecipientCount: 0,
  assignedPrizeRecipientCount: 0,
  drawOptionCount: 8,
  useWeights: false,
};

describe('preparation readiness', () => {
  it('opens the roster as the only recovery when a people draw has no roster', () => {
    expect(derivePreparationReadiness({
      ...BASE,
      participantTotal: 0,
      eligibleParticipantCount: 0,
      candidateParticipantCount: 0,
      drawOptionCount: 0,
    })).toMatchObject({ state: 'blocked', issue: 'people-roster-empty', recovery: 'open-roster' });
  });

  it('restores excluded participants before considering other blocked rules', () => {
    expect(derivePreparationReadiness({
      ...BASE,
      eligibleParticipantCount: 0,
      candidateParticipantCount: 0,
      excludedParticipantCount: 8,
      drawOptionCount: 0,
      useWeights: true,
    })).toMatchObject({ state: 'blocked', issue: 'people-all-excluded', recovery: 'restore-excluded' });
  });

  it('offers equal probability when every people weight is zero', () => {
    expect(derivePreparationReadiness({
      ...BASE,
      drawOptionCount: 0,
      useWeights: true,
    })).toMatchObject({ state: 'blocked', issue: 'people-all-weights-zero', recovery: 'use-equal-probability' });
  });

  it('returns a limited empty pool to the whole roster', () => {
    expect(derivePreparationReadiness({
      ...BASE,
      candidateParticipantCount: 0,
      drawOptionCount: 0,
      poolLimit: 4,
    })).toMatchObject({ state: 'blocked', issue: 'people-pool-empty', recovery: 'use-whole-roster' });
  });

  it('allows a prize draw to be configured without a people roster', () => {
    expect(derivePreparationReadiness({
      ...BASE,
      target: 'prizes',
      participantTotal: 0,
      eligibleParticipantCount: 0,
      candidateParticipantCount: 0,
      prizeInventoryCount: 3,
      drawOptionCount: 3,
    })).toEqual({ state: 'ready', statusLabel: '준비 완료', ctaLabel: '3종 · 재고 3개 · 한 번에 1개 · 방송 화면 열기' });
  });

  it('requires an explicit restart after every linked recipient was assigned', () => {
    expect(derivePreparationReadiness({
      ...BASE,
      target: 'prizes',
      participantTotal: 0,
      eligibleParticipantCount: 0,
      candidateParticipantCount: 0,
      prizeInventoryCount: 4,
      prizeRecipientCount: 2,
      assignedPrizeRecipientCount: 2,
      drawOptionCount: 2,
    })).toMatchObject({
      state: 'blocked',
      issue: 'prize-recipients-complete',
      recovery: 'restart-prize-recipients',
    });
  });

  it('shows assignment completion before asking to replenish the last consumed product', () => {
    expect(derivePreparationReadiness({
      ...BASE,
      target: 'prizes',
      participantTotal: 0,
      eligibleParticipantCount: 0,
      candidateParticipantCount: 0,
      prizeInventoryCount: 0,
      prizeRecipientCount: 1,
      assignedPrizeRecipientCount: 1,
      drawOptionCount: 0,
    })).toMatchObject({ state: 'blocked', issue: 'prize-recipients-complete' });
  });

  it('adds inventory before opening a prize stage', () => {
    expect(derivePreparationReadiness({
      ...BASE,
      target: 'prizes',
      participantTotal: 0,
      eligibleParticipantCount: 0,
      candidateParticipantCount: 0,
      drawOptionCount: 0,
    })).toMatchObject({ state: 'blocked', issue: 'prize-inventory-empty', recovery: 'add-prize' });
  });

  it('opens the stage with one-at-a-time draw semantics when ready', () => {
    expect(derivePreparationReadiness({ ...BASE, drawOptionCount: 6 }))
      .toEqual({ state: 'ready', statusLabel: '준비 완료', ctaLabel: '6명 · 한 번에 1명 · 방송 화면 열기' });
  });
});
