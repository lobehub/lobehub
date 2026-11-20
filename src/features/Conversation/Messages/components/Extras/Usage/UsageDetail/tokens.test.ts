import { describe, expect, it } from 'vitest';

import { getDetailsToken } from './tokens';

const modelCard = {
  pricing: {
    currency: 'USD',
    units: [
      { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
    ],
  },
} as any;

describe('getDetailsToken cost', () => {
  it('returns costs in dollars rather than micro-dollar integers', () => {
    const result = getDetailsToken(
      { totalInputTokens: 1000, totalOutputTokens: 500, totalTokens: 1500 } as any,
      modelCard,
    );

    // 1000 * $2/1M = $0.002; 500 * $10/1M = $0.005
    expect(result.totalInput?.cost).toBeCloseTo(0.002, 10);
    expect(result.totalOutput?.cost).toBeCloseTo(0.005, 10);
    expect(result.totalTokens?.cost).toBeCloseTo(0.007, 10);
  });
});
