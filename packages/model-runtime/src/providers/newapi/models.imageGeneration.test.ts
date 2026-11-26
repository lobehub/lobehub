// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { params } from './index';

describe('NewAPI models with image generation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps an image-generation model without upstream parameters', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const client = {
      apiKey: 'test-key',
      baseURL: 'https://api.newapi.com/v1',
      models: {
        list: vi.fn().mockResolvedValue({
          data: [
            {
              created: 1,
              id: 'gpt-image-2.5',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai', 'image-generation'],
            },
            {
              created: 1,
              id: 'gpt-image-1',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai', 'image-generation'],
            },
            { created: 1, id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
          ],
        }),
      },
    };

    const models = await params.models({ client: client as any });

    const unknownImageModel = models.find((model) => model.id === 'gpt-image-2.5');
    expect(unknownImageModel).toBeDefined();
    expect(unknownImageModel?.type).toBe('image');
    expect(unknownImageModel?.parameters).toEqual({ prompt: { default: '' } });

    // A model LobeHub already knows keeps its richer local schema.
    const knownImageModel = models.find((model) => model.id === 'gpt-image-1');
    expect(knownImageModel?.parameters).toHaveProperty('size');
    expect(knownImageModel?.parameters).toHaveProperty('imageUrls');

    expect(models.find((model) => model.id === 'gpt-4o-mini')).toBeDefined();
  });
});
