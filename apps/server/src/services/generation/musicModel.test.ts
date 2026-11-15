import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveMusicModelCard } from './musicModel';

const { mockFindByIdAndProvider, mockLoadModels } = vi.hoisted(() => ({
  mockFindByIdAndProvider: vi.fn(),
  mockLoadModels: vi.fn(),
}));

vi.mock('@/database/models/aiModel', async (importOriginal) => {
  const { AiModelModel } = (await importOriginal()) as any;
  return {
    AiModelModel: Object.assign(
      vi.fn(function () {
        return { findByIdAndProvider: mockFindByIdAndProvider };
      }),
      { isPreferenceOnlyRow: AiModelModel.isPreferenceOnlyRow },
    ),
  };
});
vi.mock('@lobechat/business-model-bank/model-config', () => ({ loadModels: mockLoadModels }));

const builtinSong = {
  id: 'song-model',
  outputsPerRequest: 2,
  parameters: { prompt: { default: '' } },
  pricing: { units: [] },
  providerId: 'fal',
  type: 'text2music',
};

const resolve = (model: string, provider: string) =>
  resolveMusicModelCard({ db: {} as any, model, provider, userId: 'u' });

describe('resolveMusicModelCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadModels.mockResolvedValue([
      builtinSong,
      { id: 'speech-02-hd', providerId: 'minimax', type: 'tts' },
    ]);
    mockFindByIdAndProvider.mockResolvedValue(undefined);
  });

  it('uses the built-in card', async () => {
    await expect(resolve('song-model', 'fal')).resolves.toEqual({
      outputsPerRequest: 2,
      parameters: builtinSong.parameters,
      pricing: builtinSong.pricing,
      type: 'text2music',
    });
  });

  it('reports the type of a non-music model so the router can reject it', async () => {
    await expect(resolve('speech-02-hd', 'minimax')).resolves.toMatchObject({ type: 'tts' });
  });

  it('prefers a user row (custom model) and keeps built-in params when the row has none', async () => {
    mockFindByIdAndProvider.mockResolvedValue({
      displayName: 'My Music',
      enabled: true,
      parameters: {},
      source: 'custom',
      type: 'text2music',
    });

    await expect(resolve('song-model', 'my-music-proxy')).resolves.toMatchObject({
      outputsPerRequest: 2,
      parameters: builtinSong.parameters,
      type: 'text2music',
    });
  });

  it('ignores a preference-only row and returns undefined for unknown models', async () => {
    mockFindByIdAndProvider.mockResolvedValue({ type: 'chat' });
    await expect(resolve('song-model', 'fal')).resolves.toMatchObject({ type: 'text2music' });

    mockFindByIdAndProvider.mockResolvedValue(undefined);
    await expect(resolve('nope', 'fal')).resolves.toBeUndefined();
  });

  it('defaults to one song for a custom model without outputsPerRequest', async () => {
    mockFindByIdAndProvider.mockResolvedValue({
      enabled: true,
      parameters: { prompt: { default: '' } },
      source: 'custom',
      type: 'text2music',
    });

    await expect(resolve('my-music', 'custom-provider')).resolves.toMatchObject({
      outputsPerRequest: 1,
    });
  });
});
