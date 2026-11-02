import { afterEach, describe, expect, it, vi } from 'vitest';

const loadBudgetDefaults = async () => {
  vi.resetModules();
  const module = await import('../onDemandContext');
  return module.resolveOnDemandContextBudgetDefaults();
};

afterEach(() => {
  delete process.env.ON_DEMAND_CONTEXT_DYNAMIC_TOKENS;
  delete process.env.ON_DEMAND_CONTEXT_RESERVE_TOKENS;
  delete process.env.ON_DEMAND_CONTEXT_TOTAL_TOKENS;
});

describe('resolveOnDemandContextBudgetDefaults', () => {
  it('uses the shared 15,500 + 4,500 default allocation', async () => {
    await expect(loadBudgetDefaults()).resolves.toEqual({
      dynamicTokens: 15_500,
      reserveTokens: 4_500,
      totalTokens: 20_000,
    });
  });

  it('reads deployment overrides from one configuration object', async () => {
    process.env.ON_DEMAND_CONTEXT_DYNAMIC_TOKENS = '1200';
    process.env.ON_DEMAND_CONTEXT_RESERVE_TOKENS = '300';
    process.env.ON_DEMAND_CONTEXT_TOTAL_TOKENS = '1500';

    await expect(loadBudgetDefaults()).resolves.toEqual({
      dynamicTokens: 1200,
      reserveTokens: 300,
      totalTokens: 1500,
    });
  });

  it('rejects overrides whose dynamic and reserve allocations exceed total', async () => {
    process.env.ON_DEMAND_CONTEXT_DYNAMIC_TOKENS = '1200';
    process.env.ON_DEMAND_CONTEXT_RESERVE_TOKENS = '400';
    process.env.ON_DEMAND_CONTEXT_TOTAL_TOKENS = '1500';

    await expect(loadBudgetDefaults()).rejects.toThrow(
      'ON_DEMAND_CONTEXT_DYNAMIC_TOKENS + ON_DEMAND_CONTEXT_RESERVE_TOKENS',
    );
  });
});
