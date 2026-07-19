import { describe, expect, it } from 'vitest';

import type { DrawRecord, PrizeRecipient } from '../types';
import {
  createStoredPrizeAssignment,
  mergePrizeAssignmentResults,
  parseStoredPrizeAssignment,
} from './prizeAssignmentStorage';

const recipients: PrizeRecipient[] = [
  { id: 'winner-a', name: '아모레또', source: 'linked', sourceResultId: 'a' },
  { id: 'winner-b', name: '유레카', source: 'linked', sourceResultId: 'b' },
];

const result: DrawRecord = {
  id: 'product-a',
  createdAt: '2026-07-20T00:00:00.000Z',
  revealedAt: '2026-07-20T00:00:04.000Z',
  mode: 'wheel',
  target: 'prizes',
  winner: '케이크',
  recipient: '아모레또',
  recipientId: 'winner-a',
  prizeAssignmentBatchId: 'batch-1',
};

describe('prize assignment persistence', () => {
  it('restores recipient slots, progress, and the revealed mapping together', () => {
    const stored = createStoredPrizeAssignment(
      'batch-1',
      'linked',
      recipients,
      [result],
    );
    const parsed = parseStoredPrizeAssignment(JSON.stringify(stored));

    expect(parsed).toMatchObject({
      batchId: 'batch-1',
      source: 'linked',
      assignedRecipientIds: ['winner-a'],
    });
    expect(parsed?.recipients.map((item) => item.name)).toEqual(['아모레또', '유레카']);
    expect(parsed?.results).toEqual([result]);
  });

  it('rejects invalid data and results from a different explicit batch', () => {
    expect(parseStoredPrizeAssignment('{broken')).toBeNull();
    expect(parseStoredPrizeAssignment(JSON.stringify({ version: 1, batchId: '', recipients: [] }))).toBeNull();

    const stored = createStoredPrizeAssignment('batch-2', 'manual', recipients, [result]);
    expect(stored.results).toEqual([]);
    expect(stored.assignedRecipientIds).toEqual([]);
  });

  it('consumes a recipient when a click-time result is recovered before reveal', () => {
    const pendingResult = { ...result, revealedAt: undefined };
    const recovered = mergePrizeAssignmentResults('batch-1', recipients, [], [pendingResult]);

    expect(recovered).toEqual([pendingResult]);
    expect(createStoredPrizeAssignment('batch-1', 'linked', recipients, recovered).assignedRecipientIds)
      .toEqual(['winner-a']);
  });
});
