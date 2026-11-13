import type { EnabledAiModel } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { getMusicModelList } from '../action';

const sunoSchema = { prompt: { default: '' }, style: { default: null } };

const enabledModels = [
  {
    abilities: {},
    description: 'Suno V6',
    displayName: 'Suno V6',
    enabled: true,
    id: 'suno-v6',
    outputsPerRequest: 2,
    parameters: sunoSchema,
    pricing: { units: [] },
    providerId: 'suno',
    type: 'text2music',
  },
  {
    abilities: {},
    displayName: 'Suno chat',
    enabled: true,
    id: 'suno-chat',
    providerId: 'suno',
    type: 'chat',
  },
  {
    abilities: {},
    displayName: 'MiniMax Music',
    enabled: true,
    id: 'music-2.6',
    parameters: { prompt: { default: '' } },
    pricing: { units: [] },
    providerId: 'minimax',
    type: 'text2music',
  },
] as unknown as EnabledAiModel[];

describe('getMusicModelList', () => {
  it('collects only text2music models of the provider with their schema and song count', async () => {
    const list = await getMusicModelList(enabledModels, 'suno');

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      description: 'Suno V6',
      displayName: 'Suno V6',
      id: 'suno-v6',
      outputsPerRequest: 2,
      parameters: sunoSchema,
    });
  });

  it('returns an empty list for a provider without music models', async () => {
    expect(await getMusicModelList(enabledModels, 'openai')).toEqual([]);
  });
});
