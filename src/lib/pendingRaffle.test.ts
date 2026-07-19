import { describe, expect, it } from 'vitest';

import type { DrawRecord } from '../types';
import {
  consumePendingRecord,
  mergeRecoveredHistory,
  parsePendingRaffleLock,
  type PendingRaffleLock,
} from './pendingRaffle';

const LOCKED_RESULT: DrawRecord = {
  id: 'result-1',
  sessionId: 'session-1',
  createdAt: '2026-07-19T06:00:00.000Z',
  roundId: 'round-1',
  roundOrder: 1,
  mode: 'wheel',
  presentation: 'spin',
  target: 'people',
  winner: '레또',
};

const PENDING: PendingRaffleLock = {
  version: 1,
  roundId: 'round-1',
  savedAt: '2026-07-19T06:00:00.000Z',
  records: [LOCKED_RESULT],
};

describe('pending raffle recovery', () => {
  it('accepts only the versioned minimal lock schema', () => {
    expect(parsePendingRaffleLock(JSON.stringify(PENDING))).toEqual(PENDING);
    expect(parsePendingRaffleLock('{broken')).toBeNull();
    expect(parsePendingRaffleLock(JSON.stringify({ ...PENDING, version: 2 }))).toBeNull();
    expect(parsePendingRaffleLock(JSON.stringify({ ...PENDING, records: [] }))).toBeNull();
  });

  it('recovers a click-time result without duplicating an already saved record', () => {
    const revealed = { ...LOCKED_RESULT, revealedAt: '2026-07-19T06:00:05.000Z' };
    expect(mergeRecoveredHistory([revealed], PENDING)).toEqual([revealed]);
  });

  it('keeps unrelated history behind the recovered result', () => {
    const older = { ...LOCKED_RESULT, id: 'result-old', winner: '이전 당첨자' };
    expect(mergeRecoveredHistory([older], PENDING)).toEqual([LOCKED_RESULT, older]);
  });

  it('preserves the broadcast session id through parse and history recovery', () => {
    const parsed = parsePendingRaffleLock(JSON.stringify(PENDING));
    expect(parsed?.records[0].sessionId).toBe('session-1');
    expect(parsed ? mergeRecoveredHistory([], parsed)[0].sessionId : undefined).toBe('session-1');
  });

  it('preserves a product recipient slot and quantity-ratio audit model', () => {
    const productPending: PendingRaffleLock = {
      ...PENDING,
      records: [{
        ...LOCKED_RESULT,
        target: 'prizes',
        winner: '케이크',
        prize: '케이크',
        prizeId: 'cake',
        recipient: '아모레또',
        recipientId: 'winner-result-1',
        prizeProbabilityModel: 'quantity-ratio',
        prizeAssignmentBatchId: 'assignment-1',
      }],
    };

    expect(parsePendingRaffleLock(JSON.stringify(productPending))?.records[0]).toMatchObject({
      recipient: '아모레또',
      recipientId: 'winner-result-1',
      prizeProbabilityModel: 'quantity-ratio',
      prizeAssignmentBatchId: 'assignment-1',
    });
  });

  it('consumes each result exactly once and removes an empty lock', () => {
    expect(consumePendingRecord(PENDING, 'missing')).toEqual(PENDING);
    expect(consumePendingRecord(PENDING, LOCKED_RESULT.id)).toBeNull();
  });
});
