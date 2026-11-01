import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { computeChatCost } from './computeChatCost';

describe('computeChatCost with providerBillableUnit units', () => {
  const pricing: Pricing = {
    units: [{ name: 'providerBillableUnit', rate: 1.5, strategy: 'fixed', unit: 'unit' }],
  };

  it('bills provider-reported units at the per-unit USD rate', () => {
    // fal gpt-image-2 default generation reports 0.04 billable units ($0.04)
    const result = computeChatCost(pricing, { providerBillableUnits: 0.04 });

    expect(result?.breakdown).toHaveLength(1);
    expect(result?.breakdown[0]).toMatchObject({ quantity: 0.04 });
    expect(result?.totalCost).toBe(0.06);
  });

  it('ignores token counts for unit-billed pricing', () => {
    const result = computeChatCost(pricing, { outputImageTokens: 1000, totalOutputTokens: 1000 });

    expect(result?.breakdown).toHaveLength(0);
    expect(result?.totalCost).toBe(0);
  });

  it('rounds fractional credits up', () => {
    const result = computeChatCost(pricing, { providerBillableUnits: 0.0000001 });

    expect(result?.totalCredits).toBe(1);
    expect(result?.totalCost).toBe(0.000001);
  });

  it('rejects non-fixed unit pricing', () => {
    const tiered = {
      units: [
        {
          name: 'providerBillableUnit',
          strategy: 'tiered',
          tiers: [{ rate: 1, upTo: 'infinity' }],
          unit: 'unit',
        },
      ],
    } as Pricing;

    expect(() => computeChatCost(tiered, { providerBillableUnits: 1 })).toThrow(
      'Unsupported strategy for unit pricing',
    );
  });
});
