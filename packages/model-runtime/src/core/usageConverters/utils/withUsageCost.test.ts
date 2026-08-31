import type { ModelUsage } from '@lobechat/types';
import type { Pricing } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withUsageCost } from './withUsageCost';

const fixedPricing: Pricing = {
  units: [
    { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
  ],
};

const lookupPricing: Pricing = {
  units: [
    {
      lookup: { prices: { '1h': 2, '5m': 1.25 }, pricingParams: ['ttl'] },
      name: 'textInput_cacheWrite',
      strategy: 'lookup',
      unit: 'millionTokens',
    },
  ],
};

const textUsage: ModelUsage = {
  inputCacheMissTokens: 1_000_000,
  totalInputTokens: 1_000_000,
  totalOutputTokens: 0,
  totalTokens: 1_000_000,
};

const writeUsage: ModelUsage = {
  inputWriteCacheTokens: 1_000_000,
  totalInputTokens: 1_000_000,
  totalTokens: 1_000_000,
};

describe('withUsageCost', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the usage untouched when pricing is absent', () => {
    expect(withUsageCost(textUsage)).toBe(textUsage);
  });

  it('attaches the computed cost and stays silent when every unit resolves', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = withUsageCost(textUsage, fixedPricing);

    expect(result.cost).toBeCloseTo(1, 10);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when pricing resolution produced issues instead of silently pricing $0', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // No options supplied, so the ttl lookup cannot resolve its key.
    const result = withUsageCost(writeUsage, lookupPricing);

    expect(result.cost).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    const serialized = String(warn.mock.calls[0][1]);
    expect(serialized).toContain('Missing lookup params');
    expect(serialized).toContain('textInput_cacheWrite');
  });

  it('includes the caller identity in the warning payload', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pricing: Pricing = {
      units: [
        {
          lookup: { prices: { '1h': 2 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    };

    withUsageCost(writeUsage, pricing, undefined, { model: 'm-1', provider: 'p-1' });

    const serialized = String(warn.mock.calls[0][1]);
    expect(serialized).toContain('"model":"m-1"');
    expect(serialized).toContain('"provider":"p-1"');
  });

  it('warns once per pricing card for a repeating failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inputLookupPricing: Pricing = {
      units: [
        {
          lookup: { prices: { high: 3, low: 1 }, pricingParams: ['thinkingMode'] },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    };

    withUsageCost(textUsage, inputLookupPricing);
    withUsageCost(textUsage, inputLookupPricing);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns separately for distinct pricing cards with the same failure shape', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const makePricing = (): Pricing => ({
      units: [
        {
          lookup: { prices: { high: 3, low: 1 }, pricingParams: ['thinkingMode'] },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    });

    withUsageCost(textUsage, makePricing());
    withUsageCost(textUsage, makePricing());

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('re-warns only the new issue when a later call adds one (A then A+B)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const twoLookupPricing: Pricing = {
      units: [
        {
          lookup: { prices: { high: 3, low: 1 }, pricingParams: ['thinkingMode'] },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: { prices: { high: 6, low: 2 }, pricingParams: ['thinkingMode'] },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    };

    // First call only exercises the input unit (issue A)...
    withUsageCost(
      { inputCacheMissTokens: 1_000_000, totalInputTokens: 1_000_000 },
      twoLookupPricing,
    );
    // ...the second adds output tokens (issues A+B) and must warn only about B.
    withUsageCost(
      {
        inputCacheMissTokens: 1_000_000,
        outputTextTokens: 1_000_000,
        totalInputTokens: 1_000_000,
        totalOutputTokens: 1_000_000,
      },
      twoLookupPricing,
    );

    expect(warn).toHaveBeenCalledTimes(2);
    const second = String(warn.mock.calls[1][1]);
    expect(second).toContain('textOutput');
    expect(second).not.toContain('"textInput"');
  });

  it('caps the number of distinct warnings per pricing card', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cappedPricing: Pricing = {
      units: [
        {
          lookup: { prices: { '1h': 2 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    };

    // Each invalid ttl value produces a distinct failure reason.
    for (let i = 0; i < 40; i++) {
      withUsageCost(writeUsage, cappedPricing, { lookupParams: { ttl: 'bad-' + i } });
    }

    expect(warn).toHaveBeenCalledTimes(32);
  });

  it('does not warn when the lookup resolves through options', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = withUsageCost(writeUsage, lookupPricing, { lookupParams: { ttl: '5m' } });

    expect(result.cost).toBeCloseTo(1.25, 10);
    expect(warn).not.toHaveBeenCalled();
  });
});
