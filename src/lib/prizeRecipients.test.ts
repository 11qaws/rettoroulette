import { describe, expect, it } from 'vitest';

import type { DrawRecord } from '../types';
import {
  appendPrizeAssignmentResult,
  arePrizeRecipientPlansEqual,
  countAssignedPrizeRecipients,
  createLinkedPrizeRecipients,
  createManualPrizeRecipients,
  findLatestPeopleWinnerResults,
  findNextPrizeRecipient,
  parsePrizeRecipientNames,
  reconcileManualPrizeRecipients,
  retainAssignedPrizeRecipientIds,
  retainPrizeAssignmentResults,
} from './prizeRecipients';

function record(overrides: Partial<DrawRecord>): DrawRecord {
  return {
    id: overrides.id ?? 'result',
    sessionId: overrides.sessionId,
    createdAt: overrides.createdAt ?? '2026-07-20T00:00:00.000Z',
    revealedAt: overrides.revealedAt,
    roundOrder: overrides.roundOrder,
    mode: 'wheel',
    target: overrides.target ?? 'people',
    winner: overrides.winner ?? '아모레또',
    ...overrides,
  };
}

describe('prize recipient flow', () => {
  it('parses one name per line while preserving duplicate winner slots', () => {
    expect(parsePrizeRecipientNames(' 아모레또 \n\n유레카\n아모레또 '))
      .toEqual(['아모레또', '유레카', '아모레또']);

    let sequence = 0;
    const recipients = createManualPrizeRecipients('아모레또\n아모레또', () => `manual-${sequence += 1}`);
    expect(recipients.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'manual-1', name: '아모레또' },
      { id: 'manual-2', name: '아모레또' },
    ]);
  });

  it('links only revealed people results in the supplied reveal order', () => {
    const recipients = createLinkedPrizeRecipients([
      record({ id: 'one', sessionId: 'people-1', revealedAt: '2026-07-20T00:01:00.000Z', winner: '아모레또' }),
      record({ id: 'pending', sessionId: 'people-1', winner: '공개 전' }),
      record({ id: 'prize', target: 'prizes', revealedAt: '2026-07-20T00:02:00.000Z', winner: '버거' }),
      record({ id: 'two', sessionId: 'people-1', revealedAt: '2026-07-20T00:03:00.000Z', winner: '아모레또' }),
    ]);

    expect(recipients.map(({ id, name, sourceResultId }) => ({ id, name, sourceResultId }))).toEqual([
      { id: 'winner-one', name: '아모레또', sourceResultId: 'one' },
      { id: 'winner-two', name: '아모레또', sourceResultId: 'two' },
    ]);
  });

  it('recovers only the latest people session from newest-first history in reveal order', () => {
    const history = [
      record({ id: 'new-2', sessionId: 'new', revealedAt: '2026-07-20T00:04:00.000Z', winner: '세나' }),
      record({ id: 'product', target: 'prizes', sessionId: 'product', revealedAt: '2026-07-20T00:03:30.000Z', winner: '버거' }),
      record({ id: 'new-1', sessionId: 'new', revealedAt: '2026-07-20T00:03:00.000Z', winner: '유레카' }),
      record({ id: 'old', sessionId: 'old', revealedAt: '2026-07-20T00:01:00.000Z', winner: '아모레또' }),
    ];

    expect(findLatestPeopleWinnerResults(history).map((result) => result.winner))
      .toEqual(['유레카', '세나']);
  });

  it('advances one assignment slot at a time, including duplicate names', () => {
    let sequence = 0;
    const recipients = createManualPrizeRecipients('아모레또\n아모레또\n코코', () => `r-${sequence += 1}`);

    expect(findNextPrizeRecipient(recipients, [])?.id).toBe('r-1');
    expect(findNextPrizeRecipient(recipients, ['r-1'])?.id).toBe('r-2');
    expect(findNextPrizeRecipient(recipients, ['r-1', 'r-2'])?.name).toBe('코코');
    expect(findNextPrizeRecipient(recipients, recipients.map((recipient) => recipient.id))).toBeUndefined();
    expect(countAssignedPrizeRecipients(recipients, ['r-1', 'r-1', 'unknown'])).toBe(1);
  });

  it('keeps unchanged assignment ids while reordering, adding, or removing names', () => {
    let sequence = 0;
    const previous = createManualPrizeRecipients('아모레또\n유레카', () => `old-${sequence += 1}`);
    const edited = reconcileManualPrizeRecipients(
      '유레카\n코코\n아모레또',
      previous,
      () => `new-${sequence += 1}`,
    );

    expect(edited.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'old-2', name: '유레카' },
      { id: 'new-3', name: '코코' },
      { id: 'old-1', name: '아모레또' },
    ]);
  });

  it('locks every recipient identity after the first assignment', () => {
    let sequence = 0;
    const previous = createManualPrizeRecipients('아모레또\n아모레또', () => `slot-${sequence += 1}`);
    const edited = reconcileManualPrizeRecipients('아모렛또\n유레카', previous, () => 'new', ['slot-1']);

    expect(edited).toEqual(previous);
    expect(findNextPrizeRecipient(edited, ['slot-1'])?.id).toBe('slot-2');
  });

  it('keeps an in-place typo correction for an unassigned slot', () => {
    let sequence = 0;
    const previous = createManualPrizeRecipients('아모레또\n유레카', () => `slot-${sequence += 1}`);
    const edited = reconcileManualPrizeRecipients('아모렛또\n유레카', previous, () => 'new');

    expect(edited.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'slot-1', name: '아모렛또' },
      { id: 'slot-2', name: '유레카' },
    ]);
    expect(findNextPrizeRecipient(edited, ['slot-1'])?.id).toBe('slot-2');
  });

  it('does not treat a pasted replacement roster as typo corrections', () => {
    let sequence = 0;
    const previous = createManualPrizeRecipients('아모레또\n유레카', () => `old-${sequence += 1}`);
    const edited = reconcileManualPrizeRecipients('코코\n망징이', previous, () => `new-${sequence += 1}`);

    expect(edited.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'new-3', name: '코코' },
      { id: 'new-4', name: '망징이' },
    ]);
    expect(retainAssignedPrizeRecipientIds(edited, ['old-1'])).toEqual([]);
  });

  it('recognizes the same linked plan and retains only matching progress', () => {
    const linked = createLinkedPrizeRecipients([
      record({ id: 'one', sessionId: 'people', revealedAt: '2026-07-20T00:01:00.000Z', winner: '아모레또' }),
      record({ id: 'two', sessionId: 'people', revealedAt: '2026-07-20T00:02:00.000Z', winner: '유레카' }),
    ]);
    const extended = [...linked, {
      id: 'winner-three',
      name: '세나',
      source: 'linked' as const,
      sourceResultId: 'three',
    }];

    expect(arePrizeRecipientPlansEqual(linked, [...linked])).toBe(true);
    expect(arePrizeRecipientPlansEqual(linked, extended)).toBe(false);
    expect(retainAssignedPrizeRecipientIds(extended, ['winner-one', 'unknown', 'winner-one']))
      .toEqual(['winner-one']);
  });

  it('keeps one revealed product per recipient across resumed broadcast sessions', () => {
    const recipients = createLinkedPrizeRecipients([
      record({ id: 'one', sessionId: 'people', revealedAt: '2026-07-20T00:01:00.000Z', winner: '아모레또' }),
      record({ id: 'two', sessionId: 'people', revealedAt: '2026-07-20T00:02:00.000Z', winner: '유레카' }),
    ]);
    const first = record({
      id: 'prize-one',
      target: 'prizes',
      winner: '케이크',
      recipientId: recipients[0].id,
      recipient: recipients[0].name,
      revealedAt: '2026-07-20T00:03:00.000Z',
    });
    const duplicate = { ...first, id: 'late-duplicate' };
    const second = record({
      id: 'prize-two',
      target: 'prizes',
      winner: '버거',
      recipientId: recipients[1].id,
      recipient: recipients[1].name,
      revealedAt: '2026-07-20T00:04:00.000Z',
    });

    const resumed = appendPrizeAssignmentResult(
      appendPrizeAssignmentResult(appendPrizeAssignmentResult([], first), duplicate),
      second,
    );
    expect(resumed.map((item) => `${item.recipient}→${item.winner}`))
      .toEqual(['아모레또→케이크', '유레카→버거']);
    expect(retainPrizeAssignmentResults(resumed, recipients.slice(1)).map((item) => item.id))
      .toEqual(['prize-two']);
  });
});
