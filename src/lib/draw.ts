export interface WeightedItem {
  weight: number;
}

/** A source that returns a number in the half-open interval [0, 1). */
export type RandomSource = () => number;

/**
 * A frozen-in-time draw order. `indices` point at the source list and
 * `options` retain the corresponding object references for the reveal UI.
 */
export interface WeightedDrawPlan<T> {
  indices: number[];
  options: T[];
}

export function randomUnit(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

function usableWeight(item: WeightedItem): number {
  return Number.isFinite(item.weight) ? Math.max(0, item.weight) : 0;
}

function safeRandomUnit(random: RandomSource): number {
  const value = random();

  if (!Number.isFinite(value)) return 0;

  return Math.min(Math.max(value, 0), 1 - Number.EPSILON);
}

function normalizeCount(count: number): number {
  if (!Number.isFinite(count)) return 0;

  return Math.max(0, Math.floor(count));
}

function pickWeightedCandidateIndex<T extends WeightedItem>(
  items: readonly T[],
  candidateIndices: readonly number[],
  random: RandomSource,
): number {
  if (candidateIndices.length === 0) return -1;

  const total = candidateIndices.reduce((sum, index) => sum + usableWeight(items[index]), 0);

  // A zero-weight item is an explicit exclusion. The UI removes these before
  // starting a draw; keeping the primitive strict protects other callers too.
  if (total <= 0) return -1;

  let cursor = safeRandomUnit(random) * total;

  for (const index of candidateIndices) {
    cursor -= usableWeight(items[index]);
    if (cursor < 0) return index;
  }

  return candidateIndices[candidateIndices.length - 1];
}

export function pickWeightedIndex(items: readonly WeightedItem[], random: RandomSource = randomUnit): number {
  return pickWeightedCandidateIndex(
    items,
    Array.from({ length: items.length }, (_, index) => index),
    random,
  );
}

/**
 * Chooses a complete reveal order at the moment the draw begins. A selected
 * option remains eligible for every later reveal in this plan.
 */
export function buildWeightedDrawPlanWithReplacement<T extends WeightedItem>(
  items: readonly T[],
  count: number,
  random: RandomSource = randomUnit,
): WeightedDrawPlan<T> {
  const limit = normalizeCount(count);
  const indices: number[] = [];

  for (let order = 0; order < limit; order += 1) {
    const index = pickWeightedIndex(items, random);
    if (index < 0) break;
    indices.push(index);
  }

  return {
    indices,
    options: indices.map((index) => items[index]),
  };
}

/**
 * Chooses a complete reveal order at the moment the draw begins. Each chosen
 * option is removed only from the private planning pool, never from `items`.
 */
export function buildWeightedDrawPlanWithoutReplacement<T extends WeightedItem>(
  items: readonly T[],
  count: number,
  random: RandomSource = randomUnit,
): WeightedDrawPlan<T> {
  const availableIndices = Array.from({ length: items.length }, (_, index) => index);
  const limit = Math.min(normalizeCount(count), availableIndices.length);
  const indices: number[] = [];

  for (let order = 0; order < limit; order += 1) {
    const selectedIndex = pickWeightedCandidateIndex(items, availableIndices, random);
    if (selectedIndex < 0) break;

    indices.push(selectedIndex);
    availableIndices.splice(availableIndices.indexOf(selectedIndex), 1);
  }

  return {
    indices,
    options: indices.map((index) => items[index]),
  };
}

export function sampleWithoutReplacement<T>(items: readonly T[], count: number, random: RandomSource = randomUnit): T[] {
  const copy = [...items];
  const limit = Math.min(normalizeCount(count), copy.length);

  for (let index = 0; index < limit; index += 1) {
    const swapIndex = index + Math.floor(safeRandomUnit(random) * (copy.length - index));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy.slice(0, limit);
}
