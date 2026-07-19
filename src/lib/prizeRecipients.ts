import type { DrawRecord, PrizeRecipient } from '../types';

export function parsePrizeRecipientNames(text: string) {
  return text
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function createManualPrizeRecipients(
  text: string,
  createId: (prefix: string) => string,
): PrizeRecipient[] {
  return parsePrizeRecipientNames(text).map((name) => ({
    id: createId('recipient'),
    name,
    source: 'manual',
  }));
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function looksLikeNameCorrection(previousName: string, nextName: string) {
  const longerLength = Math.max(previousName.length, nextName.length);
  if (longerLength === 0) return false;
  return editDistance(previousName, nextName) <= Math.max(1, Math.floor(longerLength * 0.34));
}

/** Preserves assignment slot ids for unchanged name occurrences during manual edits. */
export function reconcileManualPrizeRecipients(
  text: string,
  previous: readonly PrizeRecipient[],
  createId: (prefix: string) => string,
  assignedRecipientIds: readonly string[] = [],
): PrizeRecipient[] {
  const usedIds = new Set<string>();
  const assignedIds = new Set(assignedRecipientIds);
  // Once a prize has been disclosed, editing names is an identity decision,
  // not text cleanup. The UI requires an explicit new assignment first.
  if (previous.some((recipient) => assignedIds.has(recipient.id))) return [...previous];
  const names = parsePrizeRecipientNames(text);
  const reconciled: Array<PrizeRecipient | undefined> = names.map((name, nextIndex) => {
    const candidates = previous
      .map((recipient, previousIndex) => ({ recipient, previousIndex }))
      .filter(({ recipient }) => recipient.name === name && !usedIds.has(recipient.id))
      .sort((left, right) => {
        // Identical text cannot reveal which occurrence was removed. Retain a
        // completed slot first so the same visible name is not awarded twice.
        const leftAssigned = assignedIds.has(left.recipient.id) ? 0 : 1;
        const rightAssigned = assignedIds.has(right.recipient.id) ? 0 : 1;
        if (leftAssigned !== rightAssigned) return leftAssigned - rightAssigned;
        return Math.abs(left.previousIndex - nextIndex) - Math.abs(right.previousIndex - nextIndex);
      });
    const retained = candidates[0]?.recipient;
    if (!retained) return undefined;

    usedIds.add(retained.id);
    return { ...retained, source: 'manual' };
  });

  // Pair remaining rows by the closest position. This treats an in-place typo
  // correction as a rename of the same assignment slot instead of a new gift.
  for (let nextIndex = 0; nextIndex < reconciled.length; nextIndex += 1) {
    if (reconciled[nextIndex]) continue;
    const nearest = previous
      .map((recipient, previousIndex) => ({ recipient, previousIndex }))
      .filter(({ recipient }) => (
        !usedIds.has(recipient.id)
        && looksLikeNameCorrection(recipient.name, names[nextIndex])
      ))
      .sort((left, right) => (
        Math.abs(left.previousIndex - nextIndex) - Math.abs(right.previousIndex - nextIndex)
      ))[0]?.recipient;
    if (!nearest) continue;

    usedIds.add(nearest.id);
    reconciled[nextIndex] = { ...nearest, name: names[nextIndex], source: 'manual' };
  }

  return reconciled.map((recipient, index) => {
    if (recipient) return recipient;
    return {
      id: createId('recipient'),
      name: names[index],
      source: 'manual' as const,
    };
  });
}

/** Copies only audience-revealed people results, preserving reveal order and duplicates. */
export function createLinkedPrizeRecipients(results: readonly DrawRecord[]): PrizeRecipient[] {
  return results
    .filter((result) => result.target === 'people' && Boolean(result.revealedAt))
    .map((result) => ({
      id: `winner-${result.id}`,
      name: result.winner.trim(),
      source: 'linked' as const,
      sourceSessionId: result.sessionId,
      sourceResultId: result.id,
    }))
    .filter((recipient) => Boolean(recipient.name));
}

/**
 * History is stored newest-first. Recover the latest revealed people session,
 * then return that session in the order viewers saw it.
 */
export function findLatestPeopleWinnerResults(history: readonly DrawRecord[]): DrawRecord[] {
  const latest = history.find((result) => result.target === 'people' && Boolean(result.revealedAt));
  if (!latest) return [];
  if (!latest.sessionId) return [latest];

  return history
    .filter((result) => (
      result.target === 'people'
      && result.sessionId === latest.sessionId
      && Boolean(result.revealedAt)
    ))
    .sort((left, right) => {
      const leftTime = Date.parse(left.revealedAt ?? left.createdAt);
      const rightTime = Date.parse(right.revealedAt ?? right.createdAt);
      if (leftTime !== rightTime) return leftTime - rightTime;
      return (left.roundOrder ?? 0) - (right.roundOrder ?? 0);
    });
}

export function findNextPrizeRecipient(
  recipients: readonly PrizeRecipient[],
  assignedRecipientIds: readonly string[],
) {
  const assigned = new Set(assignedRecipientIds);
  return recipients.find((recipient) => !assigned.has(recipient.id));
}

export function countAssignedPrizeRecipients(
  recipients: readonly PrizeRecipient[],
  assignedRecipientIds: readonly string[],
) {
  const recipientIds = new Set(recipients.map((recipient) => recipient.id));
  return new Set(assignedRecipientIds.filter((id) => recipientIds.has(id))).size;
}

export function arePrizeRecipientPlansEqual(
  left: readonly PrizeRecipient[],
  right: readonly PrizeRecipient[],
) {
  return left.length === right.length && left.every((recipient, index) => (
    recipient.id === right[index]?.id && recipient.name === right[index]?.name
  ));
}

export function retainAssignedPrizeRecipientIds(
  recipients: readonly PrizeRecipient[],
  assignedRecipientIds: readonly string[],
) {
  const retainedIds = new Set(recipients.map((recipient) => recipient.id));
  return [...new Set(assignedRecipientIds.filter((id) => retainedIds.has(id)))];
}

/** One recipient slot can own at most one revealed product result in a batch. */
export function appendPrizeAssignmentResult(
  results: readonly DrawRecord[],
  result: DrawRecord,
) {
  if (result.target !== 'prizes' || !result.recipientId) return [...results];
  if (results.some((item) => item.id === result.id || item.recipientId === result.recipientId)) {
    return [...results];
  }
  return [...results, result];
}

export function retainPrizeAssignmentResults(
  results: readonly DrawRecord[],
  recipients: readonly PrizeRecipient[],
) {
  const retainedIds = new Set(recipients.map((recipient) => recipient.id));
  return results.filter((result) => (
    result.target === 'prizes'
    && Boolean(result.recipientId)
    && retainedIds.has(result.recipientId as string)
  ));
}
