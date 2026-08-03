import { describe, expect, it } from 'vitest';

import { mapOpenRouterModelCard, typeFromOpenRouterOutputModalities } from './modelFetch';
import type { OpenRouterModelCard } from './type';

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
  });
});
