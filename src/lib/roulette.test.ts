import { describe, expect, it } from 'vitest';

import { AUTO_POINTER_ANGLE, DART_IMPACT_ANGLE, nextWheelRotation, targetWheelRotation } from './roulette';

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
});
