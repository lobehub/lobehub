import { describe, expect, it } from 'vitest';

import { SPIN_TURN_MS, spinHoldMs } from './spinHold';

describe('spinHoldMs', () => {
  it('pads an instant refresh out to the two-turn floor', () => {
    expect(spinHoldMs(0)).toBe(2 * SPIN_TURN_MS);
    expect(spinHoldMs(80)).toBe(2 * SPIN_TURN_MS - 80);
  });

  it('adds nothing when the refresh already took exactly two turns', () => {
    expect(spinHoldMs(2 * SPIN_TURN_MS)).toBe(0);
  });

  it('rounds a slow refresh up to the next whole turn', () => {
    expect(spinHoldMs(2 * SPIN_TURN_MS + 1)).toBe(SPIN_TURN_MS - 1);
    expect(spinHoldMs(2.5 * SPIN_TURN_MS)).toBe(0.5 * SPIN_TURN_MS);
  });

  it('always lands the total spin on a whole number of turns', () => {
    for (const elapsed of [0, 1, 599, 600, 1199, 1200, 1201, 4321]) {
      expect((elapsed + spinHoldMs(elapsed)) % SPIN_TURN_MS).toBe(0);
    }
  });

  it('never asks the caller to spin backwards', () => {
    for (const elapsed of [0, 500, 1200, 5000, 60_000]) {
      expect(spinHoldMs(elapsed)).toBeGreaterThanOrEqual(0);
    }
  });
});
