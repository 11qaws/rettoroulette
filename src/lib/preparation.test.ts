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
  drawOptionCount: 8,
  effectiveWinnerCount: 1,
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
    })).toEqual({ state: 'ready', statusLabel: '준비 완료', ctaLabel: '3개 중 1개 · 방송 화면 열기' });
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

  it('opens the stage with an exact candidate and winner summary when ready', () => {
    expect(derivePreparationReadiness({ ...BASE, drawOptionCount: 6, effectiveWinnerCount: 2 }))
      .toEqual({ state: 'ready', statusLabel: '준비 완료', ctaLabel: '6명 중 2명 · 방송 화면 열기' });
  });
});
