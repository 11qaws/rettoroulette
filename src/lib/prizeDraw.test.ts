import { describe, expect, it } from 'vitest';

import { createPrizeDrawOptions } from './prizeDraw';

describe('prize wheel geometry', () => {
  it('uses one sector per product type and remaining quantity as its ratio', () => {
    expect(createPrizeDrawOptions([
      { id: 'cake', name: '케이크', quantity: 3, weight: 99 },
      { id: 'burger', name: '버거', quantity: 2, weight: 1 },
    ])).toEqual([
      { id: 'cake', sourceId: 'cake', name: '케이크', weight: 3 },
      { id: 'burger', sourceId: 'burger', name: '버거', weight: 2 },
    ]);
  });

  it('omits blank and sold-out products instead of creating repeated slices', () => {
    expect(createPrizeDrawOptions([
      { id: 'blank', name: ' ', quantity: 4, weight: 1 },
      { id: 'sold', name: '쿠키', quantity: 0, weight: 1 },
      { id: 'left', name: ' 콜라 ', quantity: 1, weight: 1 },
    ])).toEqual([{ id: 'left', sourceId: 'left', name: '콜라', weight: 1 }]);
  });

  it('keeps duplicate visible product names in one combined sector', () => {
    expect(createPrizeDrawOptions([
      { id: 'cake-a', name: '케이크', quantity: 3, weight: 1 },
      { id: 'cake-b', name: ' 케이크 ', quantity: 2, weight: 1 },
      { id: 'burger', name: '버거', quantity: 1, weight: 1 },
    ])).toEqual([
      { id: 'cake-a', sourceId: 'cake-a', name: '케이크', weight: 5 },
      { id: 'burger', sourceId: 'burger', name: '버거', weight: 1 },
    ]);
  });

  it('moves a combined sector to the next stock row after the first row is consumed', () => {
    const prizes = [
      { id: 'cake-a', name: '케이크', quantity: 1, weight: 1 },
      { id: 'cake-b', name: '케이크', quantity: 2, weight: 1 },
    ];
    expect(createPrizeDrawOptions(prizes)).toEqual([
      { id: 'cake-a', sourceId: 'cake-a', name: '케이크', weight: 3 },
    ]);

    prizes[0] = { ...prizes[0], quantity: 0 };
    expect(createPrizeDrawOptions(prizes)).toEqual([
      { id: 'cake-b', sourceId: 'cake-b', name: '케이크', weight: 2 },
    ]);
  });
});
