import type { EnabledAiModel } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { getMusicModelList } from '../action';

const songSchema = { prompt: { default: '' }, style: { default: null } };

const enabledModels = [
  {
    abilities: {},
    description: 'Song Model',
    displayName: 'Song Model',
    enabled: true,
    id: 'song-model',
    outputsPerRequest: 2,
    parameters: songSchema,
    pricing: { units: [] },
    providerId: 'fal',
    type: 'text2music',
  },
  {
    abilities: {},
    displayName: 'Song chat',
    enabled: true,
    id: 'song-chat',
    providerId: 'fal',
    type: 'chat',
  },
  {
    abilities: {},
    displayName: 'Song Lite',
    enabled: true,
    id: 'song-model-lite',
    parameters: { prompt: { default: '' } },
    pricing: { units: [] },
    providerId: 'acme',
    type: 'text2music',
  },
] as unknown as EnabledAiModel[];

describe('getMusicModelList', () => {
  it('collects only text2music models of the provider with their schema and song count', async () => {
    const list = await getMusicModelList(enabledModels, 'fal');

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      description: 'Song Model',
      displayName: 'Song Model',
      id: 'song-model',
      outputsPerRequest: 2,
      parameters: songSchema,
    });
  });

  it('returns an empty list for a provider without music models', async () => {
    expect(await getMusicModelList(enabledModels, 'openai')).toEqual([]);
  });
});
