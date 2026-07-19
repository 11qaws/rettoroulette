/**
 * The raffle lifecycle is intentionally separate from the editable draw
 * settings. A status answers one question only: what may the host do now?
 *
 * The draw result is committed before `presenting`; animation only reveals a
 * result that has already been fixed. This keeps the on-air explanation and
 * the actual behaviour aligned.
 */
export const RAFFLE_STATUSES = [
  'roster',
  'configuring',
  'ready',
  'locking',
  'presenting',
  'completed',
] as const;

export type RaffleStatus = typeof RAFFLE_STATUSES[number];

export const RAFFLE_EVENTS = [
  'save-roster',
  'cancel-roster-configuring',
  'cancel-roster-ready',
  'cancel-roster-completed',
  'open-roster',
  'end-broadcast',
  'open-stage',
  'lock-result',
  'start-presentation',
  'complete-round',
  'start-next-round',
] as const;

export type RaffleEvent = typeof RAFFLE_EVENTS[number];

type RaffleStatusMeta = {
  step: 1 | 2 | 3 | 4;
  label: string;
  liveLabel: string;
};

export const RAFFLE_STATUS_META: Record<RaffleStatus, RaffleStatusMeta> = {
  roster: { step: 1, label: '명단 준비', liveLabel: '명단 준비' },
  configuring: { step: 2, label: '추첨 설정', liveLabel: '다음 회차 설정' },
  ready: { step: 3, label: '추첨 대기', liveLabel: '추첨 대기' },
  locking: { step: 3, label: '결과 고정', liveLabel: '결과 고정' },
  presenting: { step: 3, label: '방송 연출', liveLabel: '결과 공개 중' },
  completed: { step: 4, label: '결과 확정', liveLabel: '결과 확정' },
};

const TRANSITIONS: Record<RaffleStatus, Partial<Record<RaffleEvent, RaffleStatus>>> = {
  roster: {
    'save-roster': 'configuring',
    'cancel-roster-configuring': 'configuring',
    'cancel-roster-ready': 'ready',
    'cancel-roster-completed': 'completed',
  },
  configuring: {
    'open-roster': 'roster',
    'open-stage': 'ready',
  },
  ready: {
    'open-roster': 'roster',
    'end-broadcast': 'configuring',
    'lock-result': 'locking',
  },
  locking: {
    'start-presentation': 'presenting',
  },
  presenting: {
    'lock-result': 'locking',
    'complete-round': 'completed',
  },
  completed: {
    'open-roster': 'roster',
    'end-broadcast': 'configuring',
    'start-next-round': 'ready',
  },
};

export function getRaffleTransition(status: RaffleStatus, event: RaffleEvent) {
  return TRANSITIONS[status][event] ?? null;
}

export function isRaffleActive(status: RaffleStatus) {
  return status === 'locking' || status === 'presenting';
}
