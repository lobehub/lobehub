// @vitest-environment node
import { getModelParameters, getModelPricing } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fillVideoPricingDefaults } from './videoPricingDefaults';

vi.mock('@lobechat/model-runtime', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  getModelParameters: vi.fn(),
  getModelPricing: vi.fn(),
}));

const perSecondPricing = {
  units: [
    {
      lookup: { prices: { '480P': 0.05, '768P': 0.08 }, pricingParams: ['resolution'] },
      name: 'videoGeneration',
      strategy: 'lookup',
      unit: 'second',
    },
  ],
};

const parameters = {
  duration: { default: 5, enum: [5, 10] },
  prompt: { default: '' },
  resolution: { default: '768P', enum: ['480P', '768P'] },
  seed: { default: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getModelPricing).mockResolvedValue(perSecondPricing as any);
  vi.mocked(getModelParameters).mockResolvedValue(parameters as any);
});

describe('fillVideoPricingDefaults', () => {
  it('fills omitted pricing params from the model card defaults', async () => {
    const result = await fillVideoPricingDefaults({
      model: 'minimax/h3-max',
      params: { prompt: 'a cat' },
      provider: 'lobehub',
    });

    expect(result).toEqual({ duration: 5, prompt: 'a cat', resolution: '768P' });
  });

  it('keeps params the request already set', async () => {
    const result = await fillVideoPricingDefaults({
      model: 'minimax/h3-max',
      params: { duration: 10, prompt: 'a cat', resolution: '480P' },
      provider: 'lobehub',
    });

    expect(result).toEqual({ duration: 10, prompt: 'a cat', resolution: '480P' });
  });

  it('leaves params untouched when the price does not depend on them', async () => {
    vi.mocked(getModelPricing).mockResolvedValue({ approximatePricePerVideo: 0.4, units: [] });
    const params = { prompt: 'a cat' };

    const result = await fillVideoPricingDefaults({
      model: 'other',
      params,
      provider: 'lobehub',
    });

    expect(result).toBe(params);
    expect(getModelParameters).not.toHaveBeenCalled();
  });
});
