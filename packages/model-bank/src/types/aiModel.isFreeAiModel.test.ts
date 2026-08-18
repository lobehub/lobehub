import { describe, expect, it } from 'vitest';

import { isFreeAiModel } from './aiModel';

describe('isFreeAiModel', () => {
  it('detects :free in model id', () => {
    expect(isFreeAiModel({ id: 'meta-llama/llama-3.3-70b-instruct:free' })).toBe(true);
  });

  it('detects (free) in display name', () => {
    expect(isFreeAiModel({ displayName: 'Gemma 2 9B (free)', id: 'google/gemma-2-9b-it' })).toBe(
      true,
    );
  });

  it('is case-insensitive for (free) in display name', () => {
    expect(isFreeAiModel({ displayName: 'Gemma 2 9B (Free)', id: 'google/gemma-2-9b-it' })).toBe(
      true,
    );
  });

  it('returns false for paid models', () => {
    expect(isFreeAiModel({ displayName: 'GPT-4o', id: 'openai/gpt-4o' })).toBe(false);
  });

  it('does not treat image or video generators as free even with (free) stamps', () => {
    expect(
      isFreeAiModel({
        displayName: 'Flux 2 (free)',
        id: 'black-forest-labs/flux-2',
        type: 'image',
      }),
    ).toBe(false);
    expect(
      isFreeAiModel({
        displayName: 'Veo 3 (free)',
        id: 'google/veo-3',
        type: 'video',
      }),
    ).toBe(false);
  });
});
