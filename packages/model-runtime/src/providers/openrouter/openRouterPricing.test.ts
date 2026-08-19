import { describe, expect, it } from 'vitest';

import {
  resolveOpenRouterImageEndpointPricing,
  resolveOpenRouterVideoPricing,
} from './openRouterPricing';
import type { OpenRouterImageEndpoint, OpenRouterVideoModelCard } from './type';

const videoCard = (
  overrides: Partial<OpenRouterVideoModelCard> & { id: string },
): OpenRouterVideoModelCard => ({
  allowed_passthrough_parameters: [],
  canonical_slug: overrides.id,
  created: 1_700_000_000,
  generate_audio: true,
  name: overrides.id,
  pricing_skus: {},
  seed: true,
  supported_aspect_ratios: ['16:9', '9:16'],
  supported_durations: [4, 6, 8],
  supported_frame_images: ['first_frame'],
  supported_resolutions: ['720p', '1080p'],
  supported_sizes: ['1280x720'],
  ...overrides,
});

describe('resolveOpenRouterImageEndpointPricing', () => {
  it('maps Seedream per-image output to a fixed imageGeneration unit', () => {
    const endpoints: OpenRouterImageEndpoint[] = [
      {
        pricing: [{ billable: 'output_image', cost_usd: 0.04, unit: 'image' }],
        supported_parameters: { resolution: { type: 'enum', values: ['1K', '2K', '4K'] } },
      },
    ];

    expect(resolveOpenRouterImageEndpointPricing(endpoints)).toEqual({
      approximatePricePerImage: 0.04,
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    });
  });

  it('maps Flux megapixel output to imageGeneration / megapixel', () => {
    const endpoints: OpenRouterImageEndpoint[] = [
      {
        pricing: [{ billable: 'output_image', cost_usd: 0.03, unit: 'megapixel' }],
      },
    ];

    expect(resolveOpenRouterImageEndpointPricing(endpoints)?.units).toEqual([
      { name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'megapixel' },
    ]);
  });

  it('maps GPT token output to imageOutput / millionTokens so chat cost can bill', () => {
    const endpoints: OpenRouterImageEndpoint[] = [
      {
        pricing: [
          { billable: 'input_image', cost_usd: 0.00001, unit: 'token' },
          { billable: 'output_image', cost_usd: 0.00004, unit: 'token' },
        ],
      },
    ];

    expect(resolveOpenRouterImageEndpointPricing(endpoints)).toEqual({
      currency: 'USD',
      units: [
        { name: 'imageOutput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    });
  });

  it('maps Grok resolution/quality variants to a lookup table', () => {
    const endpoints: OpenRouterImageEndpoint[] = [
      {
        pricing: [
          { billable: 'output_image', cost_usd: 0.04, unit: 'image', variant: 'low_1k' },
          { billable: 'output_image', cost_usd: 0.06, unit: 'image', variant: 'low_2k' },
          { billable: 'output_image', cost_usd: 0.06, unit: 'image', variant: 'medium_1k' },
          { billable: 'output_image', cost_usd: 0.08, unit: 'image', variant: 'medium_2k' },
        ],
        supported_parameters: { resolution: { values: ['1K', '2K'] } },
      },
    ];

    const pricing = resolveOpenRouterImageEndpointPricing(endpoints);
    expect(pricing?.approximatePricePerImage).toBe(0.04);
    expect(pricing?.units[0]).toMatchObject({
      lookup: {
        prices: {
          low_1K: 0.04,
          low_2K: 0.06,
          medium_1K: 0.06,
          medium_2K: 0.08,
        },
        pricingParams: ['quality', 'resolution'],
      },
      name: 'imageGeneration',
      strategy: 'lookup',
      unit: 'image',
    });
  });
});

describe('resolveOpenRouterVideoPricing', () => {
  it('keeps Veo per-second SKUs as a resolution/audio lookup plus approximate clip cost', () => {
    const pricing = resolveOpenRouterVideoPricing(
      videoCard({
        id: 'google/veo-3.1-fast',
        pricing_skus: {
          duration_seconds_with_audio: '0.12',
          duration_seconds_with_audio_4k: '0.30',
          duration_seconds_with_audio_720p: '0.10',
          duration_seconds_without_audio_720p: '0.08',
        },
        supported_durations: [4, 6, 8],
        supported_resolutions: ['720p', '1080p', '4K'],
      }),
    );

    expect(pricing?.approximatePricePerVideo).toBe(0.4);
    expect(pricing?.units[0]).toMatchObject({
      name: 'videoGeneration',
      strategy: 'lookup',
      unit: 'second',
    });
    const prices = pricing?.units[0].strategy === 'lookup' ? pricing.units[0].lookup.prices : {};
    expect(prices['720p_true']).toBe(0.1);
    expect(prices['4K_true']).toBe(0.3);
    expect(prices['720p_false']).toBe(0.08);
    expect(prices['1080p_true']).toBe(0.12);
  });

  it('converts cents-per-second SKUs to USD', () => {
    const pricing = resolveOpenRouterVideoPricing(
      videoCard({
        generate_audio: false,
        id: 'black-forest-labs/flux-3-video',
        pricing_skus: {
          cents_per_second_output: '17',
          cents_per_second_output_720p: '17',
          cents_per_second_output_1080p: '29',
        },
        supported_durations: [5],
        supported_resolutions: ['720p', '1080p'],
      }),
    );

    expect(pricing?.units[0]).toMatchObject({ strategy: 'lookup', unit: 'second' });
    const prices = pricing?.units[0].strategy === 'lookup' ? pricing.units[0].lookup.prices : {};
    expect(prices['720p']).toBe(0.17);
    expect(prices['1080p']).toBe(0.29);
    expect(pricing?.approximatePricePerVideo).toBeCloseTo(0.85);
  });

  it('preserves Seedance video-token billing as millionTokens', () => {
    const pricing = resolveOpenRouterVideoPricing(
      videoCard({
        id: 'bytedance/seedance-2.0',
        pricing_skus: {
          video_tokens: '0.000007',
          video_tokens_1080p: '0.0000077',
          video_tokens_4k: '0.000004',
          video_tokens_with_video_input: '0.0000043',
        },
        supported_resolutions: ['720p', '1080p', '4K'],
      }),
    );

    expect(pricing?.units[0]).toMatchObject({
      name: 'videoGeneration',
      strategy: 'lookup',
      unit: 'millionTokens',
    });
    const prices = pricing?.units[0].strategy === 'lookup' ? pricing.units[0].lookup.prices : {};
    expect(prices['1080p']).toBe(7.7);
    expect(prices['4K']).toBe(4);
  });
});
