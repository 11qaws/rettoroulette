import { describe, expect, it, vi } from 'vitest';

import {
  buildWeightedDrawPlanWithReplacement,
  buildWeightedDrawPlanWithoutReplacement,
  pickWeightedIndex,
  sampleWithoutReplacement,
} from './draw';

describe('pickWeightedIndex', () => {
  it('uses the selected item weights', () => {
    vi.stubGlobal('crypto', {
      getRandomValues(values: Uint32Array) {
        values[0] = 0;
        return values;
      },
    });

    expect(pickWeightedIndex([{ weight: 2 }, { weight: 1 }])).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe('sampleWithoutReplacement', () => {
  it('does not repeat sampled entries', () => {
    const result = sampleWithoutReplacement(['a', 'b', 'c', 'd'], 3);

    expect(result).toHaveLength(3);
    expect(new Set(result).size).toBe(3);
  });
});

describe('weighted draw plans', () => {
  const options = [
    { id: 'a', weight: 1 },
    { id: 'b', weight: 2 },
    { id: 'c', weight: 1 },
  ];

  it('builds a deterministic replacement plan in reveal order without changing the source', () => {
    const sourceBefore = structuredClone(options);
    const randomValues = [0, 0.5, 0.99];
    const random = () => randomValues.shift() ?? 0;

    const plan = buildWeightedDrawPlanWithReplacement(options, 3, random);

    expect(plan.indices).toEqual([0, 1, 2]);
    expect(plan.options).toEqual([options[0], options[1], options[2]]);
    expect(options).toEqual(sourceBefore);
  });

  it('allows a selected option to appear again when replacement is enabled', () => {
    const plan = buildWeightedDrawPlanWithReplacement(options, 3, () => 0.1);

    expect(plan.indices).toEqual([0, 0, 0]);
    expect(plan.options).toEqual([options[0], options[0], options[0]]);
  });

  it('builds a deterministic non-repeating plan without changing the source', () => {
    const sourceBefore = structuredClone(options);
    const randomValues = [0.99, 0.5, 0];
    const random = () => randomValues.shift() ?? 0;

    const plan = buildWeightedDrawPlanWithoutReplacement(options, 10, random);

    expect(plan.indices).toEqual([2, 1, 0]);
    expect(plan.options).toEqual([options[2], options[1], options[0]]);
    expect(new Set(plan.indices).size).toBe(plan.indices.length);
    expect(options).toEqual(sourceBefore);
  });

  it('returns no plan entries when every remaining weight is zero', () => {
    const zeroWeightOptions = [
      { id: 'a', weight: 0 },
      { id: 'b', weight: -2 },
      { id: 'c', weight: Number.NaN },
    ];

    const plan = buildWeightedDrawPlanWithoutReplacement(zeroWeightOptions, 2, () => 0.75);

    expect(plan.indices).toEqual([]);
    expect(plan.options).toEqual([]);
  });
});
