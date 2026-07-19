import type { DrawRecord, PrizeRecipient, PrizeRecipientSource } from '../types';

export const PRIZE_ASSIGNMENT_KEY = 'retto-roulette-prize-assignment';

export interface StoredPrizeAssignment {
  version: 1;
  batchId: string;
  savedAt: string;
  source: PrizeRecipientSource;
  recipients: PrizeRecipient[];
  assignedRecipientIds: string[];
  results: DrawRecord[];
}

function isRecipient(value: unknown): value is PrizeRecipient {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PrizeRecipient>;
  return typeof item.id === 'string'
    && typeof item.name === 'string'
    && (item.source === 'linked' || item.source === 'manual');
}

function isPrizeResult(value: unknown): value is DrawRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DrawRecord>;
  return typeof item.id === 'string'
    && typeof item.createdAt === 'string'
    && item.target === 'prizes'
    && typeof item.winner === 'string'
    && typeof item.recipientId === 'string';
}

export function parseStoredPrizeAssignment(raw: string | null): StoredPrizeAssignment | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const stored = value as Partial<StoredPrizeAssignment>;
    if (
      stored.version !== 1
      || typeof stored.batchId !== 'string'
      || !stored.batchId
      || (stored.source !== 'linked' && stored.source !== 'manual')
      || !Array.isArray(stored.recipients)
      || stored.recipients.length === 0
      || !stored.recipients.every(isRecipient)
      || !Array.isArray(stored.assignedRecipientIds)
      || !stored.assignedRecipientIds.every((id) => typeof id === 'string')
      || !Array.isArray(stored.results)
      || !stored.results.every(isPrizeResult)
    ) return null;

    const recipientIds = new Set(stored.recipients.map((recipient) => recipient.id));
    const results = stored.results.filter((result) => (
      recipientIds.has(result.recipientId as string)
      && result.prizeAssignmentBatchId === stored.batchId
    ));
    const assignedRecipientIds = [...new Set(results.map((result) => result.recipientId as string))];

    return {
      version: 1,
      batchId: stored.batchId,
      savedAt: typeof stored.savedAt === 'string' ? stored.savedAt : '',
      source: stored.source,
      recipients: stored.recipients,
      assignedRecipientIds,
      results,
    };
  } catch {
    return null;
  }
}

export function createStoredPrizeAssignment(
  batchId: string,
  source: PrizeRecipientSource,
  recipients: readonly PrizeRecipient[],
  results: readonly DrawRecord[],
): StoredPrizeAssignment {
  const recipientIds = new Set(recipients.map((recipient) => recipient.id));
  return {
    version: 1,
    batchId,
    savedAt: new Date().toISOString(),
    source,
    recipients: [...recipients],
    results: results.filter((result) => (
      result.target === 'prizes'
      && Boolean(result.recipientId)
      && recipientIds.has(result.recipientId as string)
      && result.prizeAssignmentBatchId === batchId
    )),
    assignedRecipientIds: [...new Set(results
      .filter((result) => (
        result.target === 'prizes'
        && Boolean(result.recipientId)
        && recipientIds.has(result.recipientId as string)
        && result.prizeAssignmentBatchId === batchId
      ))
      .map((result) => result.recipientId as string))],
  };
}

/**
 * Reconciles a click-time pending recovery with the persisted assignment.
 * The first committed result owns each recipient slot, even if its reveal was
 * interrupted before the animation callback.
 */
export function mergePrizeAssignmentResults(
  batchId: string,
  recipients: readonly PrizeRecipient[],
  storedResults: readonly DrawRecord[],
  history: readonly DrawRecord[],
) {
  const recipientIds = new Set(recipients.map((recipient) => recipient.id));
  const candidates = [...storedResults, ...history]
    .filter((result) => (
      result.target === 'prizes'
      && Boolean(result.recipientId)
      && recipientIds.has(result.recipientId as string)
      && result.prizeAssignmentBatchId === batchId
    ))
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const seenResultIds = new Set<string>();
  const seenRecipientIds = new Set<string>();

  return candidates.filter((result) => {
    const recipientId = result.recipientId as string;
    if (seenResultIds.has(result.id) || seenRecipientIds.has(recipientId)) return false;
    seenResultIds.add(result.id);
    seenRecipientIds.add(recipientId);
    return true;
  });
}
