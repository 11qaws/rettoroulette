import { describe, expect, it } from 'vitest';

import {
  AUTO_POINTER_ANGLE,
  DART_IMPACT_ANGLE,
  getRouletteSliceGeometry,
  nextWheelRotation,
  normalizeRouletteWeights,
  targetWheelRotation,
} from './roulette';

describe('targetWheelRotation', () => {
  it('aligns the first slice with the usual top pointer', () => {
    expect(targetWheelRotation(0, 4, AUTO_POINTER_ANGLE)).toBe(315);
  });

  it('aligns the same slice with the fixed dart point instead', () => {
    expect(targetWheelRotation(0, 4, DART_IMPACT_ANGLE)).toBe(3);
  });

  it('adds full visual turns without changing the final target angle', () => {
    const rotation = nextWheelRotation(711, 2, 6, 6, DART_IMPACT_ANGLE);
    expect(((rotation % 360) + 360) % 360).toBe(targetWheelRotation(2, 6, DART_IMPACT_ANGLE));
    expect(rotation).toBeGreaterThan(711 + 5 * 360);
  });

  it('uses the positive draw weights as proportional wedge geometry', () => {
    expect(normalizeRouletteWeights(3, [1, 2, 1])).toEqual([0.25, 0.5, 0.25]);

    const slices = getRouletteSliceGeometry(3, [1, 2, 1]);
    expect(slices.map((slice) => slice.startAngle)).toEqual([-90, 0, 180]);
    expect(slices.map((slice) => slice.endAngle)).toEqual([0, 180, 270]);
    expect(slices.map((slice) => slice.centreAngle)).toEqual([-45, 90, 225]);
  });

  it('aligns a weighted winner centre with both fixed presentation points', () => {
    const weights = [1, 2, 1];

    expect(targetWheelRotation(1, 3, AUTO_POINTER_ANGLE, weights)).toBe(180);
    expect(targetWheelRotation(1, 3, DART_IMPACT_ANGLE, weights)).toBe(228);

    const rotation = nextWheelRotation(289, 1, 3, 6, DART_IMPACT_ANGLE, weights);
    expect(((rotation % 360) + 360) % 360).toBe(228);
  });

  it('falls back to equal wedges when supplied weights have no positive value', () => {
    expect(normalizeRouletteWeights(4, [0, -3, Number.NaN, 0])).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
});
