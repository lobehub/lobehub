import { describe, expect, it } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { selectAgentArtworkModel } from './selectModel';

const provider = (id: string, modelIds: string[]) =>
  ({
    children: modelIds.map((modelId) => ({ abilities: {}, id: modelId })),
    id,
    name: id,
    source: 'builtin',
  }) as unknown as EnabledProviderWithModels;

describe('selectAgentArtworkModel', () => {
  it('prefers Nano Banana 2 Lite over gpt-image-2 across providers', () => {
    const selection = selectAgentArtworkModel([
      provider('openai', ['gpt-image-2']),
      provider('google', ['gemini-3.1-flash-lite-image:image']),
    ]);

    expect(selection?.model.id).toBe('gemini-3.1-flash-lite-image:image');
    expect(selection?.provider.id).toBe('google');
  });

  it('matches the preferred model without an :image suffix too', () => {
    const selection = selectAgentArtworkModel([
      provider('custom', ['gemini-3.1-flash-lite-image']),
    ]);

    expect(selection?.model.id).toBe('gemini-3.1-flash-lite-image');
  });

  it('falls back to gpt-image-2, then to the first available model', () => {
    expect(
      selectAgentArtworkModel([
        provider('fal', ['fal-ai/nano-banana']),
        provider('openai', ['gpt-image-2']),
      ])?.model.id,
    ).toBe('gpt-image-2');

    expect(selectAgentArtworkModel([provider('fal', ['fal-ai/nano-banana'])])?.model.id).toBe(
      'fal-ai/nano-banana',
    );
  });

  it('returns undefined when no image model is available', () => {
    expect(selectAgentArtworkModel([])).toBeUndefined();
  });
});
