import type { DrawRecord } from '../types';

export const PENDING_RAFFLE_KEY = 'retto-roulette-pending-result';

export type PendingRaffleLock = {
  version: 1;
  roundId: string;
  savedAt: string;
  records: DrawRecord[];
};

function isDrawRecord(value: unknown): value is DrawRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DrawRecord>;
  return typeof item.id === 'string'
    && typeof item.createdAt === 'string'
    && (item.mode === 'wheel' || item.mode === 'marble')
    && (item.target === 'people' || item.target === 'prizes')
    && typeof item.winner === 'string';
}

export function parsePendingRaffleLock(raw: string | null): PendingRaffleLock | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const pending = value as Partial<PendingRaffleLock>;
    if (
      pending.version !== 1
      || typeof pending.roundId !== 'string'
      || typeof pending.savedAt !== 'string'
      || !Array.isArray(pending.records)
      || pending.records.length === 0
      || !pending.records.every(isDrawRecord)
    ) return null;
    return pending as PendingRaffleLock;
  } catch {
    return null;
  }
}

export function mergeRecoveredHistory(
  history: readonly DrawRecord[],
  pending: PendingRaffleLock,
  limit = 100,
) {
  const historyIds = new Set(history.map((record) => record.id));
  const recovered = pending.records.filter((record) => !historyIds.has(record.id));
  return [...recovered, ...history].slice(0, limit);
}

export function consumePendingRecord(pending: PendingRaffleLock, recordId: string) {
  const records = pending.records.filter((record) => record.id !== recordId);
  return records.length === 0 ? null : { ...pending, records };
}
