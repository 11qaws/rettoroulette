import { describe, expect, it } from 'vitest';

import { isCurrentPresentationCompletion } from './presentationRun';

describe('isCurrentPresentationCompletion', () => {
  it('accepts only the spin and reveal pair currently on air', () => {
    expect(isCurrentPresentationCompletion(
      { spinKey: 12, revealId: 34 },
      12,
      34,
      34,
    )).toBe(true);
  });

  it('rejects a late spin even when its reveal id looks current', () => {
    expect(isCurrentPresentationCompletion(
      { spinKey: 11, revealId: 34 },
      12,
      34,
      34,
    )).toBe(false);
  });

  it('rejects a late reveal even when its spin key looks current', () => {
    expect(isCurrentPresentationCompletion(
      { spinKey: 12, revealId: 33 },
      12,
      34,
      34,
    )).toBe(false);
  });
});
