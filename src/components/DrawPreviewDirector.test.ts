import { describe, expect, it } from 'vitest';

import { canExposePreviewWinner, type PreviewPhase } from './DrawPreviewDirector';

describe('DrawPreviewDirector winner disclosure', () => {
  it('keeps a committed result private until motion starts', () => {
    expect(canExposePreviewWinner('idle', false)).toBe(false);
    expect(canExposePreviewWinner('cruise', false)).toBe(false);
    expect(canExposePreviewWinner('result-committed', false)).toBe(false);
    expect(canExposePreviewWinner('motion-started', true)).toBe(true);
  });

  it('allows reveal phases only while the wheel is moving, then retains the proven hold', () => {
    const movingPhases: PreviewPhase[] = [
      'boundary-entered',
      'boundary-crossed',
      'boundary-held',
      'dart-launched',
      'dart-impacted',
      'dart-attached',
      'dart-names-revealed',
      'rotation-stopped',
    ];

    for (const phase of movingPhases) {
      expect(canExposePreviewWinner(phase, true)).toBe(true);
      expect(canExposePreviewWinner(phase, false)).toBe(false);
    }
    expect(canExposePreviewWinner('hold', false)).toBe(true);
  });
});
