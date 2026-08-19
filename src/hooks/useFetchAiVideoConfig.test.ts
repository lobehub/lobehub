import { describe, expect, it } from 'vitest';

import { type EnabledProviderWithModels } from '@/types/aiProvider';

import { resolvePreferredVideoModel } from './useFetchAiVideoConfig';

describe('resolvePreferredVideoModel', () => {
  it('returns undefined for an empty list', () => {
    expect(resolvePreferredVideoModel([])).toBeUndefined();
  });

  it('prefers Veo over other enabled video models', () => {
    const list: EnabledProviderWithModels[] = [
      {
        children: [
          { displayName: 'Kling', id: 'kwaivgi/kling-v2' },
          { displayName: 'Veo 3', id: 'google/veo-3' },
        ],
        id: 'openrouter',
        name: 'OpenRouter',
        source: 'builtin',
      },
    ];

    expect(resolvePreferredVideoModel(list)).toEqual({
      model: 'google/veo-3',
      provider: 'openrouter',
    });
  });

  it('falls back to the first enabled model when no preferred family exists', () => {
    const list: EnabledProviderWithModels[] = [
      {
        children: [{ displayName: 'Kling', id: 'kwaivgi/kling-v2' }],
        id: 'openrouter',
        name: 'OpenRouter',
        source: 'builtin',
      },
    ];

    expect(resolvePreferredVideoModel(list)).toEqual({
      model: 'kwaivgi/kling-v2',
      provider: 'openrouter',
    });
  });
});
