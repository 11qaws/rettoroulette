import { describe, expect, it, vi } from 'vitest';

import { pickWeightedIndex, sampleWithoutReplacement } from './draw';

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
