import type { Prize } from '../types';

export type PrizeDrawOption = {
  id: string;
  sourceId: string;
  name: string;
  weight: number;
};

/** One wheel sector per product type; remaining quantity is its sector ratio. */
export function createPrizeDrawOptions(prizes: readonly Prize[]): PrizeDrawOption[] {
  const productTypes = new Map<string, PrizeDrawOption>();

  for (const prize of prizes) {
    const name = prize.name.trim();
    const quantity = Math.max(0, prize.quantity);
    if (!name || quantity === 0) continue;

    // Duplicate visible names are one product type on the wheel. Their stock
    // is consumed from the first still-available source row.
    const key = name.normalize('NFKC').toLocaleLowerCase('ko-KR');
    const existing = productTypes.get(key);
    if (existing) {
      existing.weight += quantity;
      continue;
    }

    productTypes.set(key, {
      id: prize.id,
      sourceId: prize.id,
      name,
      weight: quantity,
    });
  }

  return [...productTypes.values()];
}
