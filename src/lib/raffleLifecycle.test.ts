import { describe, expect, it } from 'vitest';

import { getRaffleTransition, isRaffleActive } from './raffleLifecycle';

describe('raffle lifecycle', () => {
  it('keeps the standard giveaway flow explicit', () => {
    expect(getRaffleTransition('roster', 'save-roster')).toBe('configuring');
    expect(getRaffleTransition('configuring', 'open-stage')).toBe('ready');
    expect(getRaffleTransition('ready', 'lock-result')).toBe('locking');
    expect(getRaffleTransition('locking', 'start-presentation')).toBe('presenting');
    expect(getRaffleTransition('presenting', 'complete-round')).toBe('completed');
    expect(getRaffleTransition('completed', 'start-next-round')).toBe('ready');
  });

  it('keeps a multi-shot archery round locked until it is completed or ended', () => {
    expect(getRaffleTransition('presenting', 'await-next-arrow')).toBe('awaiting-arrow');
    expect(getRaffleTransition('awaiting-arrow', 'lock-result')).toBe('locking');
    expect(getRaffleTransition('awaiting-arrow', 'end-round-early')).toBe('completed');
    expect(getRaffleTransition('awaiting-arrow', 'open-configuration')).toBeNull();
    expect(isRaffleActive('awaiting-arrow')).toBe(true);
    expect(isRaffleActive('completed')).toBe(false);
  });

  it('allows roster and rule changes only from a safe boundary', () => {
    expect(getRaffleTransition('ready', 'open-roster')).toBe('roster');
    expect(getRaffleTransition('completed', 'open-configuration')).toBe('configuring');
    expect(getRaffleTransition('presenting', 'open-roster')).toBeNull();
  });
});
