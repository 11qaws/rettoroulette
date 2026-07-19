import { describe, expect, it } from 'vitest';

import type { DrawRecord } from '../types';
import { appendBroadcastSessionResult, createBroadcastSession } from './broadcastSession';

function result(id: string, sessionId = 'session-1', target: DrawRecord['target'] = 'people'): DrawRecord {
  return {
    id,
    sessionId,
    createdAt: '2026-07-19T00:00:00.000Z',
    revealedAt: '2026-07-19T00:00:01.000Z',
    mode: 'wheel',
    presentation: 'spin',
    target,
    winner: id,
  };
}

describe('broadcast session result board', () => {
  it('keeps winners from consecutive rounds in reveal order', () => {
    const session = createBroadcastSession('session-1', 'people');
    const afterFirstRound = appendBroadcastSessionResult(session, result('winner-1'));
    const afterSecondRound = appendBroadcastSessionResult(afterFirstRound, result('winner-2'));

    expect(afterSecondRound.results.map((item) => item.id)).toEqual(['winner-1', 'winner-2']);
  });

  it('ignores duplicate late callbacks', () => {
    const session = createBroadcastSession('session-1', 'people');
    const once = appendBroadcastSessionResult(session, result('winner-1'));

    expect(appendBroadcastSessionResult(once, result('winner-1'))).toBe(once);
  });

  it('ignores results from another stage or target', () => {
    const session = createBroadcastSession('session-1', 'people');

    expect(appendBroadcastSessionResult(session, result('other-session', 'session-2'))).toBe(session);
    expect(appendBroadcastSessionResult(session, result('other-target', 'session-1', 'prizes'))).toBe(session);
  });
});
