import type { DrawRecord, DrawTarget } from '../types';

export type BroadcastSession = {
  id: string;
  target: DrawTarget;
  /** Revealed results in the exact order the audience saw them. */
  results: DrawRecord[];
};

export function createBroadcastSession(id: string, target: DrawTarget): BroadcastSession {
  return { id, target, results: [] };
}

/**
 * Adds one revealed result without allowing a late animation callback or a
 * result from another stage to contaminate the on-air winner board.
 */
export function appendBroadcastSessionResult(
  session: BroadcastSession,
  result: DrawRecord,
): BroadcastSession {
  if (
    result.sessionId !== session.id
    || result.target !== session.target
    || session.results.some((item) => item.id === result.id)
  ) {
    return session;
  }

  return { ...session, results: [...session.results, result] };
}
