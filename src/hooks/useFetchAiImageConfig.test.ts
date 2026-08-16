import { describe, expect, it } from 'vitest';

import { DEFAULT_AI_IMAGE_MODEL } from '@/store/image/slices/generationConfig/initialState';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

import { PREFERRED_AI_IMAGE_MODEL_IDS, resolvePreferredImageModel } from './useFetchAiImageConfig';

describe('resolvePreferredImageModel', () => {
  it('returns undefined for an empty list', () => {
    expect(resolvePreferredImageModel([])).toBeUndefined();
  });

  it('prefers the default OpenRouter Nano Banana 2 id', () => {
    const list: EnabledProviderWithModels[] = [
      {
        children: [
          { displayName: 'Other', id: 'black-forest-labs/flux' },
          { displayName: 'Nano Banana 2', id: DEFAULT_AI_IMAGE_MODEL },
        ],
        id: 'openrouter',
        name: 'OpenRouter',
        source: 'builtin',
      },
    ];

    expect(resolvePreferredImageModel(list)).toEqual({
      model: DEFAULT_AI_IMAGE_MODEL,
      provider: 'openrouter',
    });
    expect(PREFERRED_AI_IMAGE_MODEL_IDS[0]).toBe(DEFAULT_AI_IMAGE_MODEL);
  });

  it('falls back to Nano Banana by display name when preferred ids are absent', () => {
    const list: EnabledProviderWithModels[] = [
      {
        children: [
          { displayName: 'Flux', id: 'flux/schnell' },
          { displayName: 'Nano Banana', id: 'custom/nano-banana:image' },
        ],
        id: 'fal',
        name: 'Fal',
        source: 'builtin',
      },
    ];

    expect(resolvePreferredImageModel(list)).toEqual({
      model: 'custom/nano-banana:image',
      provider: 'fal',
    });
  });

  it('falls back to the first enabled model when nothing Nano Banana-like exists', () => {
    const list: EnabledProviderWithModels[] = [
      {
        children: [{ displayName: 'Flux', id: 'flux/schnell' }],
        id: 'fal',
        name: 'Fal',
        source: 'builtin',
      },
    ];

    expect(resolvePreferredImageModel(list)).toEqual({
      model: 'flux/schnell',
      provider: 'fal',
    });
  });
});
