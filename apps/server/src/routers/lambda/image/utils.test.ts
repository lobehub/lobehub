import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyLookupPricingParamDefaults,
  findUnsupportedImageParams,
  validateNoUrlsInConfig,
} from './utils';

const getModelPricingMock = vi.hoisted(() => vi.fn());
const getModelParametersMock = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/model-runtime', () => ({
  getModelPricing: getModelPricingMock,
  getModelParameters: getModelParametersMock,
}));

const lookupPricing = {
  units: [
    {
      lookup: {
        prices: {
          low_1k: 0.04,
          low_2k: 0.06,
          medium_1k: 0.06,
          medium_2k: 0.08,
        },
        pricingParams: ['quality', 'resolution'],
      },
      name: 'imageGeneration',
      strategy: 'lookup',
      unit: 'image',
    },
  ],
};

const modelParameters = {
  aspectRatio: { default: 'auto', enum: ['auto', '1:1'] },
  quality: { default: 'medium', enum: ['low', 'medium'] },
  resolution: { default: '1k', enum: ['1k', '2k'] },
};

describe('applyLookupPricingParamDefaults', () => {
  beforeEach(() => {
    getModelPricingMock.mockClear();
    getModelParametersMock.mockClear();
  });

  it('fills missing lookup params from model card defaults', async () => {
    getModelPricingMock.mockResolvedValue(lookupPricing);
    getModelParametersMock.mockResolvedValue(modelParameters);

    const result = await applyLookupPricingParamDefaults(
      { prompt: 'a red apple', resolution: '2k' },
      'grok-imagine-image-2.0',
      'lobehub',
    );

    expect(result).toEqual({
      prompt: 'a red apple',
      quality: 'medium',
      resolution: '2k',
    });
  });

  it('keeps explicit client params and only fills the absent ones', async () => {
    getModelPricingMock.mockResolvedValue(lookupPricing);
    getModelParametersMock.mockResolvedValue(modelParameters);

    const result = await applyLookupPricingParamDefaults(
      { prompt: 'a red apple', quality: 'low', resolution: '1k' },
      'grok-imagine-image-2.0',
      'lobehub',
    );

    expect(result).toEqual({ prompt: 'a red apple', quality: 'low', resolution: '1k' });
  });

  it('returns params untouched when pricing has no imageGeneration lookup unit', async () => {
    getModelPricingMock.mockResolvedValue({
      units: [{ name: 'imageGeneration', rate: 0.02, strategy: 'fixed', unit: 'image' }],
    });

    const params = { prompt: 'a red apple' };
    const result = await applyLookupPricingParamDefaults(params, 'grok-imagine-image', 'lobehub');

    expect(result).toBe(params);
    expect(getModelParametersMock).not.toHaveBeenCalled();
  });

  it('returns params untouched when pricing is missing', async () => {
    getModelPricingMock.mockResolvedValue(undefined);

    const params = { prompt: 'a red apple' };
    const result = await applyLookupPricingParamDefaults(params, 'unknown-model', 'lobehub');

    expect(result).toBe(params);
  });

  it('returns params untouched when pricing lookup fails', async () => {
    getModelPricingMock.mockRejectedValue(new Error('model config unavailable'));

    const params = { prompt: 'a red apple' };
    const result = await applyLookupPricingParamDefaults(
      params,
      'grok-imagine-image-2.0',
      'lobehub',
    );

    expect(result).toBe(params);
  });

  it('returns params untouched when model card has no parameters', async () => {
    getModelPricingMock.mockResolvedValue(lookupPricing);
    getModelParametersMock.mockResolvedValue(undefined);

    const params = { prompt: 'a red apple' };
    const result = await applyLookupPricingParamDefaults(
      params,
      'grok-imagine-image-2.0',
      'lobehub',
    );

    expect(result).toBe(params);
  });

  it('skips model-card defaults that are null and leaves the param absent', async () => {
    getModelPricingMock.mockResolvedValue(lookupPricing);
    getModelParametersMock.mockResolvedValue({
      quality: { default: 'medium' },
      resolution: { default: null },
    });

    const result = await applyLookupPricingParamDefaults(
      { prompt: 'a red apple' },
      'grok-imagine-image-2.0',
      'lobehub',
    );

    expect(result).toEqual({ prompt: 'a red apple', quality: 'medium' });
  });

  it('treats null lookup params as missing and backfills defaults', async () => {
    getModelPricingMock.mockResolvedValue(lookupPricing);
    getModelParametersMock.mockResolvedValue(modelParameters);

    const result = await applyLookupPricingParamDefaults(
      { prompt: 'a red apple', quality: null, resolution: null },
      'grok-imagine-image-2.0',
      'lobehub',
    );

    expect(result).toEqual({
      prompt: 'a red apple',
      quality: 'medium',
      resolution: '1k',
    });
  });
});

describe('validateNoUrlsInConfig utility', () => {
  describe('valid configurations', () => {
    it('should pass with normal keys', () => {
      const config = {
        imageUrl: 'images/photo.jpg',
        imageUrls: ['files/doc.pdf', 'assets/video.mp4'],
        prompt: 'Generate an image',
      };

      expect(() => validateNoUrlsInConfig(config)).not.toThrow();
    });

    it('should pass with empty strings', () => {
      const config = {
        imageUrl: '',
        imageUrls: [],
        prompt: 'Generate an image',
      };

      expect(() => validateNoUrlsInConfig(config)).not.toThrow();
    });

    it('should pass with null/undefined values', () => {
      const config = {
        imageUrl: null,
        imageUrls: undefined,
        prompt: 'Generate an image',
      };

      expect(() => validateNoUrlsInConfig(config)).not.toThrow();
    });
  });

  describe('invalid configurations', () => {
    it('should throw for https URL in imageUrl', () => {
      const config = {
        imageUrl: 'https://s3.amazonaws.com/bucket/image.jpg',
        prompt: 'Generate an image',
      };

      expect(() => validateNoUrlsInConfig(config)).toThrow(
        'Invalid configuration: Found full URL instead of key at imageUrl',
      );
    });

    it('should throw for http URL in imageUrls array', () => {
      const config = {
        imageUrls: ['files/doc.pdf', 'http://example.com/image.jpg'],
        prompt: 'Generate an image',
      };

      expect(() => validateNoUrlsInConfig(config)).toThrow(
        'Invalid configuration: Found full URL instead of key at imageUrls[1]',
      );
    });

    it('should throw for nested URL in complex object', () => {
      const config = {
        settings: {
          imageConfig: {
            url: 'https://cdn.example.com/very-long-url-that-exceeds-100-characters-to-test-truncation-functionality.jpg',
          },
        },
      };

      expect(() => validateNoUrlsInConfig(config)).toThrow(
        'Invalid configuration: Found full URL instead of key at settings.imageConfig.url',
      );
      expect(() => validateNoUrlsInConfig(config)).toThrow(
        'https://cdn.example.com/very-long-url-that-exceeds-100-characters-to-test-truncation-func',
      );
    });

    it('should throw for presigned URL with query parameters', () => {
      const config = {
        imageUrl: 'https://s3.amazonaws.com/bucket/file.jpg?X-Amz-Signature=abc&X-Amz-Expires=3600',
      };

      expect(() => validateNoUrlsInConfig(config)).toThrow(
        'All URLs must be converted to storage keys before database insertion',
      );
    });
  });

  describe('edge cases', () => {
    it('should handle deeply nested structures', () => {
      const config = {
        level1: {
          level2: {
            level3: {
              level4: ['normal-key', 'https://bad-url.com'],
            },
          },
        },
      };

      expect(() => validateNoUrlsInConfig(config)).toThrow(
        'Invalid configuration: Found full URL instead of key at level1.level2.level3.level4[1]',
      );
    });

    it('should not throw for strings that contain but do not start with http', () => {
      const config = {
        imageUrl: 'some-prefix-https://example.com',
        description: 'This text contains http:// but is not a URL',
      };

      expect(() => validateNoUrlsInConfig(config)).not.toThrow();
    });
  });
});

describe('findUnsupportedImageParams', () => {
  const gptImageSchema = {
    imageUrls: { default: [] },
    prompt: { default: '' },
    quality: { default: 'auto', enum: ['auto', 'high'] },
    size: { default: 'auto', enum: ['auto', '1024x1024'] },
  };

  it('reports keys the model does not declare', () => {
    expect(
      findUnsupportedImageParams(
        { height: 2048, prompt: 'a cat', size: '1024x1024', width: 2048 },
        gptImageSchema,
      ),
    ).toEqual(['height', 'width']);
  });

  it('accepts declared keys and prompt', () => {
    expect(
      findUnsupportedImageParams(
        { prompt: 'a cat', quality: 'high', size: 'auto' },
        gptImageSchema,
      ),
    ).toEqual([]);
  });

  it('ignores keys without a value', () => {
    expect(
      findUnsupportedImageParams(
        { imageUrl: null, prompt: 'a cat', seed: undefined },
        gptImageSchema,
      ),
    ).toEqual([]);
  });
});
