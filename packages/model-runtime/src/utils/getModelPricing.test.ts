import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadModelsMock = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

const { getModelPricing, registerModelPricingResolver } = await import('./getModelPricing');

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
});

describe('registerModelPricingResolver', () => {
  const livePricing = {
    units: [{ name: 'textInput', rate: 9, strategy: 'fixed', unit: 'millionTokens' }],
  } as const;
  const disposers: Array<() => void> = [];

  const register = (...args: Parameters<typeof registerModelPricingResolver>) => {
    const dispose = registerModelPricingResolver(...args);
    disposers.push(dispose);
    return dispose;
  };

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
    ]);
  });

  afterEach(() => {
    while (disposers.length > 0) disposers.pop()!();
  });

  it('should answer with the resolver pricing and pass it the model and pricing context', async () => {
    const resolver = vi.fn().mockReturnValue(livePricing);
    register('test-live', resolver);
    const ctx = { plan: 'premium', scope: 'personal' } as const;

    const result = await getModelPricing('gpt-4o', 'test-live', ctx);

    expect(result).toEqual(livePricing);
    expect(resolver).toHaveBeenCalledWith('gpt-4o', ctx);
  });

  it('should treat a resolver that answers undefined as final, never falling back to another provider card', async () => {
    register('test-live', () => undefined);

    await expect(getModelPricing('gpt-4o', 'test-live')).resolves.toBeUndefined();
  });

  it('should restore the model bank fallback once the resolver is removed', async () => {
    const dispose = register('test-live', () => livePricing);
    dispose();

    const result = await getModelPricing('gpt-4o', 'test-live');

    expect(result).toEqual(await getModelPricing('gpt-4o'));
    expect(result).toEqual({
      units: [{ name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' }],
    });
  });

  it('should leave a provider without a resolver on the model bank path', async () => {
    register('test-live', () => livePricing);

    const result = await getModelPricing('gpt-4o', 'openai');

    expect(result).toEqual({
      units: [{ name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' }],
    });
  });

  it('should await an async resolver', async () => {
    register('test-live', async () => livePricing);

    await expect(getModelPricing('gpt-4o', 'test-live')).resolves.toEqual(livePricing);
  });
});
