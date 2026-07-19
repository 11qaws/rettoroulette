import { describe, expect, it } from 'vitest';

import {
  getRaffleTransition,
  isRaffleActive,
  RAFFLE_EVENTS,
  RAFFLE_STATUSES,
  type RaffleEvent,
  type RaffleStatus,
} from './raffleLifecycle';

const ALLOWED_TRANSITIONS: Record<RaffleStatus, Partial<Record<RaffleEvent, RaffleStatus>>> = {
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

describe('raffle lifecycle', () => {
  it('keeps the standard giveaway flow explicit', () => {
    expect(getRaffleTransition('roster', 'save-roster')).toBe('configuring');
    expect(getRaffleTransition('configuring', 'open-stage')).toBe('ready');
    expect(getRaffleTransition('ready', 'lock-result')).toBe('locking');
    expect(getRaffleTransition('locking', 'start-presentation')).toBe('presenting');
    expect(getRaffleTransition('presenting', 'complete-round')).toBe('completed');
    expect(getRaffleTransition('completed', 'start-next-round')).toBe('ready');
  });

  it('allows roster and rule changes only from a safe boundary', () => {
    expect(getRaffleTransition('ready', 'open-roster')).toBe('roster');
    expect(getRaffleTransition('ready', 'end-broadcast')).toBe('configuring');
    expect(getRaffleTransition('completed', 'end-broadcast')).toBe('configuring');
    expect(getRaffleTransition('presenting', 'open-roster')).toBeNull();
    expect(getRaffleTransition('presenting', 'end-broadcast')).toBeNull();
  });

  it('defines every allowed and forbidden transition in one exhaustive matrix', () => {
    for (const status of RAFFLE_STATUSES) {
      for (const event of RAFFLE_EVENTS) {
        expect(getRaffleTransition(status, event), `${status} + ${event}`)
          .toBe(ALLOWED_TRANSITIONS[status][event] ?? null);
      }
    }
  });

  it('never edits rules or the roster while a result is being fixed or revealed', () => {
    for (const status of ['locking', 'presenting'] as const) {
      expect(getRaffleTransition(status, 'open-roster')).toBeNull();
      expect(getRaffleTransition(status, 'end-broadcast')).toBeNull();
      expect(getRaffleTransition(status, 'open-stage')).toBeNull();
    }
  });

  it('treats only the result-owning states as active', () => {
    const activeStatuses = RAFFLE_STATUSES.filter(isRaffleActive);
    expect(activeStatuses).toEqual(['locking', 'presenting']);
  });
});
