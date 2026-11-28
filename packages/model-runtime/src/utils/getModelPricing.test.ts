import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadModelsMock = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

const { getModelPricing } = await import('./getModelPricing');

describe('getModelPricing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadModelsMock.mockResolvedValue([
      {
        id: 'gpt-4o',
        pricing: {
          units: [{ name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' }],
        },
        providerId: 'openai',
      },
      {
        id: 'gpt-4o',
        pricing: {
          units: [{ name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' }],
        },
        providerId: 'other-provider',
      },
    ]);
  });

  it('should use injected LobeHub pricing before same-id fallback pricing', async () => {
    loadModelsMock.mockResolvedValue([
      {
        id: 'injected-only-model',
        pricing: {
          units: [{ name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' }],
        },
        providerId: 'openai',
      },
      {
        id: 'injected-only-model',
        pricing: {
          units: [{ name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' }],
        },
        providerId: 'lobehub',
      },
    ]);

    const result = await getModelPricing('injected-only-model', 'lobehub');

    expect(result).toEqual({
      units: [{ name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' }],
    });
  });

  it('should propagate loadModels errors instead of falling back to static defaults', async () => {
    loadModelsMock.mockRejectedValue(new Error('model config missing'));

    await expect(getModelPricing('injected-only-model', 'lobehub')).rejects.toThrow(
      'model config missing',
    );
  });

  it('should use provider pricing when the provider match exists', async () => {
    const result = await getModelPricing('gpt-4o', 'openai');

    expect(result).toEqual({
      units: [{ name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' }],
    });
  });

  it('should pass explicit pricing context to loadModels', async () => {
    await getModelPricing('gpt-4o', 'openai', { plan: 'premium', scope: 'personal' });

    expect(loadModelsMock).toHaveBeenCalledWith({
      pricingContext: { plan: 'premium', scope: 'personal' },
    });
  });

  it('does not estimate Ace usage using another provider price', async () => {
    expect(await getModelPricing('gpt-4o', 'acedatacloud')).toBeUndefined();
    loadModelsMock.mockResolvedValue([
      { id: 'gpt-4o', providerId: 'openai', pricing: { units: [{ rate: 2.5 }] } },
      { id: 'gpt-4o', providerId: 'acedatacloud', pricing: { units: [{ rate: 0.5 }] } },
    ]);
    expect(await getModelPricing('gpt-4o', 'acedatacloud')).toEqual({ units: [{ rate: 0.5 }] });
  });
});
