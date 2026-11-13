import type { MusicModelParamsSchema } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMusicStore } from '@/store/music';

import { musicGenerationConfigSelectors } from './selectors';

const sunoSchema: MusicModelParamsSchema = {
  duration: { default: null, max: 360, min: 10, step: 1 },
  instrumental: { default: false },
  lyrics: { default: null, maxLength: 5000 },
  prompt: { default: '', maxLength: 3000 },
  style: { default: null },
  title: { default: null },
};

const coverSchema: MusicModelParamsSchema = {
  format: { default: 'mp3', enum: ['mp3', 'wav'] },
  lyrics: { default: null },
  prompt: { default: '' },
  referenceAudioUrl: { default: null, required: true },
};

const { updateSystemStatus } = vi.hoisted(() => ({ updateSystemStatus: vi.fn() }));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    enabledMusicModelList: vi.fn(() => [
      { children: [{ id: 'suno-v6', parameters: sunoSchema }], id: 'suno', name: 'Suno' },
      {
        children: [{ id: 'music-cover', parameters: coverSchema }],
        id: 'minimax',
        name: 'MiniMax',
      },
    ]),
  },
  getAiInfraStoreState: vi.fn(() => ({})),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: { getState: () => ({ updateSystemStatus }) },
}));
vi.mock('@/store/user', () => ({ useUserStore: { getState: () => ({}) } }));
vi.mock('@/store/user/selectors', () => ({ authSelectors: { isLogin: () => true } }));

describe('music generationConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMusicStore.setState({
      isInit: false,
      model: 'suno-v6',
      parameters: { prompt: '' },
      parametersSchema: { prompt: { default: '' } },
      provider: 'suno',
    });
  });

  it('initializes with the resolved model schema and defaults', () => {
    useMusicStore.getState().initializeMusicConfig('suno-v6', 'suno');

    const state = useMusicStore.getState();
    expect(state.isInit).toBe(true);
    expect(state.parametersSchema).toBe(sunoSchema);
    expect(state.parameters).toMatchObject({ instrumental: false, lyrics: null, prompt: '' });
  });

  it('keeps the placeholder when the model is not enabled', () => {
    useMusicStore.getState().initializeMusicConfig('gone', 'suno');

    const state = useMusicStore.getState();
    expect(state.isInit).toBe(true);
    expect(state.parametersSchema).toEqual({ prompt: { default: '' } });
  });

  it('switching models keeps typed text the next model declares and drops the rest', () => {
    useMusicStore.getState().initializeMusicConfig('suno-v6', 'suno');
    useMusicStore.setState({
      parameters: {
        ...useMusicStore.getState().parameters,
        lyrics: '[Chorus] la la',
        prompt: 'bossa nova',
        style: 'warm',
      },
    });

    useMusicStore.getState().setModelAndProviderOnSelect('music-cover', 'minimax');

    const state = useMusicStore.getState();
    expect(state.parametersSchema).toBe(coverSchema);
    expect(state.parameters).toEqual({
      format: 'mp3',
      lyrics: '[Chorus] la la',
      prompt: 'bossa nova',
      referenceAudioUrl: null,
    });
    expect(updateSystemStatus).toHaveBeenCalledWith({
      lastSelectedMusicModel: 'music-cover',
      lastSelectedMusicProvider: 'minimax',
    });
  });

  it('shows only the params the selected schema declares', () => {
    useMusicStore.getState().initializeMusicConfig('suno-v6', 'suno');
    const state = useMusicStore.getState();

    expect(musicGenerationConfigSelectors.isSupportedParam('style')(state)).toBe(true);
    expect(musicGenerationConfigSelectors.isSupportedParam('referenceAudioUrl')(state)).toBe(false);

    useMusicStore.getState().setModelAndProviderOnSelect('music-cover', 'minimax');
    const next = useMusicStore.getState();
    expect(musicGenerationConfigSelectors.isSupportedParam('style')(next)).toBe(false);
    expect(musicGenerationConfigSelectors.isSupportedParam('referenceAudioUrl')(next)).toBe(true);
  });

  it('canSubmit accepts lyrics or style without a prompt but requires declared reference audio', () => {
    const base = { ...useMusicStore.getState(), parametersSchema: sunoSchema };

    expect(musicGenerationConfigSelectors.canSubmit({ ...base, parameters: { prompt: '' } })).toBe(
      false,
    );
    expect(
      musicGenerationConfigSelectors.canSubmit({
        ...base,
        parameters: { lyrics: 'words', prompt: '' },
      }),
    ).toBe(true);

    // Lyrics are dropped for instrumental tracks, so they cannot stand in for a prompt
    expect(
      musicGenerationConfigSelectors.canSubmit({
        ...base,
        parameters: { instrumental: true, lyrics: 'words', prompt: '' },
      }),
    ).toBe(false);

    const cover = { ...base, parametersSchema: coverSchema };
    expect(
      musicGenerationConfigSelectors.canSubmit({ ...cover, parameters: { prompt: 'jazz cover' } }),
    ).toBe(false);
    expect(
      musicGenerationConfigSelectors.canSubmit({
        ...cover,
        parameters: { prompt: 'jazz cover', referenceAudioUrl: 'https://a.example/ref.mp3' },
      }),
    ).toBe(true);
  });

  // The first-run form must not queue a batch the provider runtime would refuse
  it('canSubmit follows the input rules of the selected model', () => {
    const state = useMusicStore.getState();
    const can = (model: string, parameters: Record<string, unknown>, schema = sunoSchema) =>
      musicGenerationConfigSelectors.canSubmit({
        ...state,
        model,
        parameters: parameters as any,
        parametersSchema: schema,
      });

    // Suno: a prompt alone is refused; a style, lyrics or reference audio is needed
    expect(can('suno-v6', { prompt: 'a happy song' })).toBe(false);
    expect(can('suno-v6', { prompt: 'a happy song', style: 'pop' })).toBe(true);
    expect(can('suno-v6', { instrumental: true, lyrics: 'words', prompt: 'p' })).toBe(false);
    // Custom mode (title or duration) needs lyrics, a style or a negative style
    expect(can('suno-v6', { prompt: 'p', title: 'Song' })).toBe(false);
    expect(can('suno-v6', { duration: 120, prompt: 'p' })).toBe(false);
    expect(can('suno-v6', { duration: 120, prompt: 'p', style: 'pop' })).toBe(true);
    expect(can('suno-v6', { negativeStyle: 'metal', title: 'Song' })).toBe(true);

    // MiniMax text to song: vocals need lyrics or auto lyrics with a prompt
    expect(can('music-2.6', { prompt: 'rainy night' })).toBe(false);
    expect(can('music-2.6', { autoLyrics: true, prompt: 'rainy night' })).toBe(true);
    expect(can('music-2.6', { lyrics: '[Verse] rain', prompt: '' })).toBe(true);
    expect(can('music-2.6', { instrumental: true, prompt: '' })).toBe(false);
    expect(can('music-2.6', { instrumental: true, prompt: 'lo-fi beat' })).toBe(true);

    // MiniMax cover: reference audio and a prompt
    expect(
      can('music-cover', { referenceAudioUrl: 'https://a.example/ref.mp3' }, coverSchema),
    ).toBe(false);
    expect(
      can(
        'music-cover',
        { prompt: 'jazz cover', referenceAudioUrl: 'https://a.example/ref.mp3' },
        coverSchema,
      ),
    ).toBe(true);
  });

  it('reuses a previous batch config, ignoring params the model does not declare', () => {
    useMusicStore
      .getState()
      .reuseMusicSettings('suno-v6', 'suno', { prompt: 'again', style: 'jazz', unknown: 1 } as any);

    const state = useMusicStore.getState();
    expect(state.model).toBe('suno-v6');
    expect(state.parameters).toMatchObject({ prompt: 'again', style: 'jazz' });
    expect(state.parameters).not.toHaveProperty('unknown');
  });
});
