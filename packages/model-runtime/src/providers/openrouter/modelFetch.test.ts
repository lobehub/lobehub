// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchOpenRouterModels,
  mapOpenRouterModelCard,
  mergeOpenRouterModelPages,
  resolveOpenRouterVideoPricing,
  typeFromOpenRouterOutputModalities,
} from './modelFetch';
import type { OpenRouterModelCard, OpenRouterVideoModelCard } from './type';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

const baseCard = (
  overrides: Partial<OpenRouterModelCard> & {
    architecture: OpenRouterModelCard['architecture'];
    id: string;
  },
): OpenRouterModelCard =>
  ({
    canonical_slug: overrides.id,
    context_length: 8192,
    created: 1_700_000_000,
    name: overrides.id,
    pricing: { completion: '0.00002', prompt: '0.00001' },
    supported_parameters: [],
    top_provider: {
      context_length: 8192,
      is_moderated: false,
      max_completion_tokens: 1024,
    },
    ...overrides,
  }) as OpenRouterModelCard;

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

describe('typeFromOpenRouterOutputModalities', () => {
  it('keeps multimodal text+* outputs untyped (chat)', () => {
    expect(typeFromOpenRouterOutputModalities(['text', 'image'])).toBeUndefined();
    expect(typeFromOpenRouterOutputModalities(['text', 'audio'])).toBeUndefined();
    expect(typeFromOpenRouterOutputModalities(['text', 'video'])).toBeUndefined();
  });

  it('maps exclusive generator outputs to dedicated types', () => {
    expect(typeFromOpenRouterOutputModalities(['image'])).toBe('image');
    expect(typeFromOpenRouterOutputModalities(['video'])).toBe('video');
    expect(typeFromOpenRouterOutputModalities(['audio'])).toBe('text2music');
  });
});

describe('mapOpenRouterModelCard modalities', () => {
  it('sets abilities from input/output modalities and keeps chat+image as chat', () => {
    const mapped = mapOpenRouterModelCard(
      baseCard({
        architecture: {
          input_modalities: ['text', 'image', 'file', 'video'],
          instruct_type: null,
          modality: 'text+image+file+video->text+image',
          output_modalities: ['text', 'image'],
          tokenizer: 'default',
        },
        id: 'google/gemini-3.1-flash-image',
      }),
    );

    expect(mapped).toMatchObject({
      files: true,
      imageOutput: true,
      type: 'chat',
      video: true,
      vision: true,
    });
  });

  it('sets type video for exclusive video output', () => {
    const mapped = mapOpenRouterModelCard(
      baseCard({
        architecture: {
          input_modalities: ['text'],
          instruct_type: null,
          modality: 'text->video',
          output_modalities: ['video'],
          tokenizer: 'default',
        },
        id: 'example/video-gen',
      }),
    );

    expect(mapped.type).toBe('video');
    expect(mapped.video).toBe(true);
    expect(mapped.parameters).toMatchObject({
      aspectRatio: expect.any(Object),
      duration: expect.any(Object),
      prompt: expect.any(Object),
    });
  });

  it('sets type image with parameters and does not stamp (free) on zero-token generators', () => {
    const mapped = mapOpenRouterModelCard(
      baseCard({
        architecture: {
          input_modalities: ['text'],
          instruct_type: null,
          modality: 'text->image',
          output_modalities: ['image'],
          tokenizer: 'default',
        },
        id: 'black-forest-labs/flux-2',
        name: 'Black Forest Labs: Flux 2',
        pricing: { completion: '0', image_output: '0.00004', prompt: '0' },
      }),
    );

    expect(mapped.type).toBe('image');
    expect(mapped.displayName).toBe('Flux 2');
    expect(mapped.displayName).not.toMatch(/\(free\)/i);
    expect(mapped.parameters).toBeDefined();
    expect(mapped.pricing).toEqual({
      currency: 'USD',
      units: [
        {
          name: 'imageGeneration',
          rate: 40,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
      ],
    });
  });

  it('still stamps (free) on zero-price chat models without image output', () => {
    const mapped = mapOpenRouterModelCard(
      baseCard({
        architecture: {
          input_modalities: ['text'],
          instruct_type: null,
          modality: 'text->text',
          output_modalities: ['text'],
          tokenizer: 'default',
        },
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        name: 'Meta: Llama 3.3 70B',
        pricing: { completion: '0', prompt: '0' },
      }),
    );

    expect(mapped.type).toBe('chat');
    expect(mapped.displayName).toBe('Llama 3.3 70B (free)');
  });
});

describe('resolveOpenRouterVideoPricing', () => {
  it('uses the default audio and resolution per-second SKU for the approximate clip cost', () => {
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
      }),
    );

    expect(pricing).toEqual({
      approximatePricePerVideo: 0.4,
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
    });
  });

  it('converts cents-per-second SKUs to USD', () => {
    const pricing = resolveOpenRouterVideoPricing(
      videoCard({
        generate_audio: false,
        id: 'runway/gen-4.5',
        pricing_skus: { cents_per_second_output: '12' },
        supported_durations: [2, 3, 4, 5],
      }),
    );

    expect(pricing?.units[0]).toMatchObject({ rate: 0.12, unit: 'second' });
    expect(pricing?.approximatePricePerVideo).toBe(0.6);
  });

  it('preserves video-token billing as a per-million-token unit', () => {
    const pricing = resolveOpenRouterVideoPricing(
      videoCard({
        id: 'bytedance/seedance-2.0',
        pricing_skus: {
          video_tokens: '0.000007',
          video_tokens_without_audio: '0.000006',
        },
      }),
    );

    expect(pricing).toEqual({
      currency: 'USD',
      units: [
        {
          name: 'videoGeneration',
          rate: 7,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
      ],
    });
  });
});

describe('mergeOpenRouterModelPages', () => {
  it('dedupes by id and lets later pages win', () => {
    const text = [
      baseCard({
        architecture: {
          input_modalities: ['text'],
          instruct_type: null,
          modality: 'text->text',
          output_modalities: ['text'],
          tokenizer: 'default',
        },
        id: 'black-forest-labs/flux-2',
      }),
    ];
    const image = [
      baseCard({
        architecture: {
          input_modalities: ['text'],
          instruct_type: null,
          modality: 'text->image',
          output_modalities: ['image'],
          tokenizer: 'default',
        },
        id: 'black-forest-labs/flux-2',
      }),
      baseCard({
        architecture: {
          input_modalities: ['text'],
          instruct_type: null,
          modality: 'text->image',
          output_modalities: ['image'],
          tokenizer: 'default',
        },
        id: 'openai/gpt-image-1',
      }),
    ];

    const merged = mergeOpenRouterModelPages([text, image]);
    expect(merged).toHaveLength(2);
    const flux = merged.find((m) => m.id === 'black-forest-labs/flux-2');
    expect(flux?.architecture.output_modalities).toEqual(['image']);
    expect(merged.some((m) => m.id === 'openai/gpt-image-1')).toBe(true);
  });
});

describe('fetchOpenRouterModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges the default catalog with image and video modality pages', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url) === 'https://openrouter.ai/api/v1/videos/models') {
        return {
          json: async () => ({
            data: [
              videoCard({
                id: 'google/veo-3',
                pricing_skus: { duration_seconds_with_audio_720p: '0.10' },
                supported_durations: [5, 8],
              }),
            ],
          }),
          ok: true,
        };
      }

      const isImage = String(url).includes('output_modalities=image');
      const isVideo = String(url).includes('output_modalities=video');
      const id = isVideo ? 'google/veo-3' : isImage ? 'black-forest-labs/flux-2' : 'openai/gpt-4o';
      const output = isVideo ? ['video'] : isImage ? ['image'] : ['text'];
      return {
        json: async () => ({
          data: [
            baseCard({
              architecture: {
                input_modalities: ['text'],
                instruct_type: null,
                modality: `text->${output[0]}`,
                output_modalities: output,
                tokenizer: 'default',
              },
              id,
              ...(isImage && {
                pricing: { completion: '0', image_output: '0.00004', prompt: '0' },
              }),
              ...(isVideo && { pricing: { completion: '0', prompt: '0' } }),
            }),
          ],
        }),
        ok: true,
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchOpenRouterModels();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(urls).toEqual(
      expect.arrayContaining([
        'https://openrouter.ai/api/v1/models',
        'https://openrouter.ai/api/v1/models?output_modalities=image',
        'https://openrouter.ai/api/v1/models?output_modalities=video',
        'https://openrouter.ai/api/v1/videos/models',
      ]),
    );
    expect(models.some((m) => m.id === 'openai/gpt-4o')).toBe(true);
    expect(models.some((m) => m.id === 'black-forest-labs/flux-2' && m.type === 'image')).toBe(
      true,
    );
    expect(models.some((m) => m.id === 'google/veo-3' && m.type === 'video')).toBe(true);
    expect(models.find((m) => m.id === 'google/veo-3')?.parameters).toMatchObject({
      duration: { default: 5, enum: [5, 8] },
      prompt: { default: '' },
    });
    expect(models.find((m) => m.id === 'google/veo-3')?.pricing).toEqual({
      approximatePricePerVideo: 0.5,
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
    });
    expect(models.find((m) => m.id === 'black-forest-labs/flux-2')?.pricing).toEqual({
      currency: 'USD',
      units: [
        {
          name: 'imageGeneration',
          rate: 40,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
      ],
    });
  });
});
