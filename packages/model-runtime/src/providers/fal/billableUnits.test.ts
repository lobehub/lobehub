// @vitest-environment node
import { createFalClient } from '@fal-ai/client';
import type { Pricing } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelPricing } from '../../utils/getModelPricing';
import { LobeFalAI } from './index';

vi.mock('@fal-ai/client', () => ({ createFalClient: vi.fn() }));
vi.mock('../../utils/getModelPricing', () => ({ getModelPricing: vi.fn() }));

const unitPricing: Pricing = {
  approximatePricePerImage: 0.0464,
  units: [{ name: 'providerBillableUnit', rate: 1.16, strategy: 'fixed', unit: 'unit' }],
};

/**
 * Make each scoped client answer `subscribe` by sending one request through the `fetch` it was
 * configured with, the way fal's queue result request does.
 */
const mockFalResult = (headers: Record<string, string>) => {
  vi.mocked(createFalClient).mockImplementation(
    (config) =>
      ({
        subscribe: async () => {
          await config!.fetch!('https://queue.fal.run/fal-ai/gpt-image-2/requests/r');
          return { data: { images: [{ url: 'https://example.com/out.png' }] }, requestId: 'r' };
        },
      }) as any,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { headers, status: 200 })),
  );
};

const payload = { model: 'gpt-image-2', params: { prompt: 'a cat' } };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LobeFalAI createImage billable units', () => {
  it('prices the billable units header with the card under the router provider id', async () => {
    mockFalResult({ 'x-fal-billable-units': '0.04' });
    vi.mocked(getModelPricing).mockResolvedValue(unitPricing);
    const pricingContext = { plan: 'pro' } as any;

    const result = await new LobeFalAI({ apiKey: 'k', id: 'lobehub' }).createImage(payload, {
      pricingContext,
    });

    expect(getModelPricing).toHaveBeenCalledWith('gpt-image-2', 'lobehub', pricingContext);
    expect(result.modelUsage).toEqual({ cost: 0.0464, providerBillableUnits: 0.04 });
  });

  it('omits usage when the card does not bill provider units', async () => {
    mockFalResult({ 'x-fal-billable-units': '1' });
    vi.mocked(getModelPricing).mockResolvedValue({
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    });

    const result = await new LobeFalAI({ apiKey: 'k' }).createImage(payload);

    expect(getModelPricing).toHaveBeenCalledWith('gpt-image-2', 'fal', undefined);
    expect(result.modelUsage).toBeUndefined();
  });

  it('settles at the per-image estimate when fal reports no billable units', async () => {
    mockFalResult({});
    vi.mocked(getModelPricing).mockResolvedValue(unitPricing);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await new LobeFalAI({ apiKey: 'k', id: 'lobehub' }).createImage(payload);

    expect(result.modelUsage).toEqual({ cost: 0.0464 });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('no x-fal-billable-units header'),
    );
  });

  it('omits usage for other cards when fal reports no billable units', async () => {
    mockFalResult({});
    vi.mocked(getModelPricing).mockResolvedValue(undefined);

    const result = await new LobeFalAI({ apiKey: 'k' }).createImage(payload);

    expect(result).toEqual({ imageUrl: 'https://example.com/out.png' });
  });

  it('keeps concurrent generations on separate billable units', async () => {
    let call = 0;
    vi.mocked(createFalClient).mockImplementation((config) => {
      call += 1;
      const units = String(call * 0.01);
      // The first generation's result arrives last
      const delay = call === 1 ? 10 : 0;
      return {
        subscribe: async () => {
          await new Promise((resolve) => setTimeout(resolve, delay));
          await config!.fetch!(`https://queue.fal.run/x/requests/${units}`);
          return {
            data: { images: [{ url: `https://example.com/${units}.png` }] },
            requestId: units,
          };
        },
      } as any;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response('{}', { headers: { 'x-fal-billable-units': url.split('/').pop()! } }),
      ),
    );
    vi.mocked(getModelPricing).mockResolvedValue(unitPricing);
    const runtime = new LobeFalAI({ apiKey: 'k', id: 'lobehub' });

    const [first, second] = await Promise.all([
      runtime.createImage(payload),
      runtime.createImage(payload),
    ]);

    // Each result carries the units from its own result response, whichever finished first
    for (const result of [first, second]) {
      expect(result.imageUrl).toBe(
        `https://example.com/${result.modelUsage?.providerBillableUnits}.png`,
      );
    }
    expect(new Set([first.imageUrl, second.imageUrl]).size).toBe(2);
  });
});
