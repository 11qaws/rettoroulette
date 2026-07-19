import type { DrawTarget } from '../types';

export type PreparationIssue =
  | 'people-roster-empty'
  | 'people-all-excluded'
  | 'people-pool-empty'
  | 'people-all-weights-zero'
  | 'prize-inventory-empty'
  | 'prize-all-weights-zero';

export type PreparationRecovery =
  | 'open-roster'
  | 'restore-excluded'
  | 'use-whole-roster'
  | 'use-equal-probability'
  | 'add-prize';

export type PreparationReadiness = {
  state: 'ready';
  statusLabel: '준비 완료';
  ctaLabel: string;
} | {
  state: 'blocked';
  issue: PreparationIssue;
  recovery: PreparationRecovery;
  statusLabel: string;
  ctaLabel: string;
};

export interface PreparationInput {
  target: DrawTarget;
  participantTotal: number;
  eligibleParticipantCount: number;
  candidateParticipantCount: number;
  excludedParticipantCount: number;
  poolLimit: number;
  prizeInventoryCount: number;
  drawOptionCount: number;
  effectiveWinnerCount: number;
  useWeights: boolean;
}

/**
 * Produces the single preparation status and the single action that can resolve
 * it. The UI projects this value; it must not invent an additional readiness
 * rule in a component.
 */
export function derivePreparationReadiness(input: PreparationInput): PreparationReadiness {
  if (input.target === 'people') {
    if (input.participantTotal === 0) {
      return {
        state: 'blocked',
        issue: 'people-roster-empty',
        recovery: 'open-roster',
        statusLabel: '명단 필요',
        ctaLabel: '명단 추가',
      };
    }

    if (input.eligibleParticipantCount === 0 && input.excludedParticipantCount > 0) {
      return {
        state: 'blocked',
        issue: 'people-all-excluded',
        recovery: 'restore-excluded',
        statusLabel: `${input.excludedParticipantCount}명 모두 제외됨`,
        ctaLabel: `${input.excludedParticipantCount}명 다시 포함`,
      };
    }

    if (input.useWeights && input.drawOptionCount === 0 && input.candidateParticipantCount > 0) {
      return {
        state: 'blocked',
        issue: 'people-all-weights-zero',
        recovery: 'use-equal-probability',
        statusLabel: '추첨권 0장',
        ctaLabel: '동일 확률로 전환',
      };
    }

    if (input.drawOptionCount === 0 && input.poolLimit > 0) {
      return {
        state: 'blocked',
        issue: 'people-pool-empty',
        recovery: 'use-whole-roster',
        statusLabel: '후보 없음',
        ctaLabel: '남은 명단 전체 사용',
      };
    }

    if (input.drawOptionCount === 0) {
      return {
        state: 'blocked',
        issue: 'people-pool-empty',
        recovery: 'open-roster',
        statusLabel: '후보 없음',
        ctaLabel: '명단 편집',
      };
    }
  } else {
    if (input.prizeInventoryCount === 0) {
      return {
        state: 'blocked',
        issue: 'prize-inventory-empty',
        recovery: 'add-prize',
        statusLabel: '상품 필요',
        ctaLabel: '상품 추가',
      };
    }

    if (input.useWeights && input.drawOptionCount === 0) {
      return {
        state: 'blocked',
        issue: 'prize-all-weights-zero',
        recovery: 'use-equal-probability',
        statusLabel: '추첨권 0장',
        ctaLabel: '동일 확률로 전환',
      };
    }
  }

  const unit = input.target === 'people' ? '명' : '개';
  return {
    state: 'ready',
    statusLabel: '준비 완료',
    ctaLabel: `${input.drawOptionCount}${unit} 중 ${input.effectiveWinnerCount}${unit} · 방송 화면 열기`,
  };
}
