export interface WeightedItem {
  weight: number;
}

export function randomUnit(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

export function pickWeightedIndex(items: WeightedItem[]): number {
  if (items.length === 0) return -1;

  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);

  if (total <= 0) return Math.floor(randomUnit() * items.length);

  let cursor = randomUnit() * total;

  for (let index = 0; index < items.length; index += 1) {
    cursor -= Math.max(0, items[index].weight);
    if (cursor < 0) return index;
  }

  return items.length - 1;
}

export function sampleWithoutReplacement<T>(items: T[], count: number): T[] {
  const copy = [...items];
  const limit = Math.max(0, Math.min(count, copy.length));

  for (let index = 0; index < limit; index += 1) {
    const swapIndex = index + Math.floor(randomUnit() * (copy.length - index));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy.slice(0, limit);
}
