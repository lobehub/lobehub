import type { MusicModelParamsSchema } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMusicStore } from '@/store/music';

import { musicGenerationConfigSelectors } from './selectors';

const songSchema: MusicModelParamsSchema = {
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
      { children: [{ id: 'song-model', parameters: songSchema }], id: 'fal', name: 'fal' },
      {
        children: [{ id: 'cover-model', parameters: coverSchema }],
        id: 'acme',
        name: 'Acme',
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
      model: 'song-model',
      parameters: { prompt: '' },
      parametersSchema: { prompt: { default: '' } },
      provider: 'fal',
    });
  });

  it('initializes with the resolved model schema and defaults', () => {
    useMusicStore.getState().initializeMusicConfig('song-model', 'fal');

    const state = useMusicStore.getState();
    expect(state.isInit).toBe(true);
    expect(state.parametersSchema).toBe(songSchema);
    expect(state.parameters).toMatchObject({ instrumental: false, lyrics: null, prompt: '' });
  });

  it('keeps the placeholder when the model is not enabled', () => {
    useMusicStore.getState().initializeMusicConfig('gone', 'fal');

    const state = useMusicStore.getState();
    expect(state.isInit).toBe(true);
    expect(state.parametersSchema).toEqual({ prompt: { default: '' } });
  });

  it('switching models keeps typed text the next model declares and drops the rest', () => {
    useMusicStore.getState().initializeMusicConfig('song-model', 'fal');
    useMusicStore.setState({
      parameters: {
        ...useMusicStore.getState().parameters,
        lyrics: '[Chorus] la la',
        prompt: 'bossa nova',
        style: 'warm',
      },
    });

    useMusicStore.getState().setModelAndProviderOnSelect('cover-model', 'acme');

    const state = useMusicStore.getState();
    expect(state.parametersSchema).toBe(coverSchema);
    expect(state.parameters).toEqual({
      format: 'mp3',
      lyrics: '[Chorus] la la',
      prompt: 'bossa nova',
      referenceAudioUrl: null,
    });
    expect(updateSystemStatus).toHaveBeenCalledWith({
      lastSelectedMusicModel: 'cover-model',
      lastSelectedMusicProvider: 'acme',
    });
  });

  it('shows only the params the selected schema declares', () => {
    useMusicStore.getState().initializeMusicConfig('song-model', 'fal');
    const state = useMusicStore.getState();

    expect(musicGenerationConfigSelectors.isSupportedParam('style')(state)).toBe(true);
    expect(musicGenerationConfigSelectors.isSupportedParam('referenceAudioUrl')(state)).toBe(false);

    useMusicStore.getState().setModelAndProviderOnSelect('cover-model', 'acme');
    const next = useMusicStore.getState();
    expect(musicGenerationConfigSelectors.isSupportedParam('style')(next)).toBe(false);
    expect(musicGenerationConfigSelectors.isSupportedParam('referenceAudioUrl')(next)).toBe(true);
  });

  it('canSubmit waits for a required prompt and for required lyrics of a vocal track', () => {
    const base = {
      ...useMusicStore.getState(),
      parametersSchema: {
        instrumental: { default: false },
        lyrics: { default: null, required: true },
        prompt: { default: '', required: true },
      },
    };
    const canSubmit = (parameters: Record<string, unknown>) =>
      musicGenerationConfigSelectors.canSubmit({ ...base, parameters } as typeof base);

    expect(canSubmit({ lyrics: 'la la', prompt: '' })).toBe(false);
    expect(canSubmit({ prompt: 'pop' })).toBe(false);
    expect(canSubmit({ lyrics: 'la la', prompt: 'pop' })).toBe(true);
    expect(canSubmit({ instrumental: true, prompt: 'pop' })).toBe(true);
  });

  it('blocks a prompt shorter than the model minimum and reports the required length', () => {
    const base = {
      ...useMusicStore.getState(),
      parametersSchema: { prompt: { default: '', minLength: 10, required: true } },
    };
    const state = (prompt: string) => ({ ...base, parameters: { prompt } }) as typeof base;

    expect(musicGenerationConfigSelectors.promptMinLength(state('和风'))).toBe(10);
    expect(musicGenerationConfigSelectors.canSubmit(state('和风'))).toBe(false);
    // An empty prompt is caught by the required rule, not reported as too short
    expect(musicGenerationConfigSelectors.promptMinLength(state(''))).toBeUndefined();
    expect(
      musicGenerationConfigSelectors.promptMinLength(state('日系和风抒情流行，少女伤感')),
    ).toBeUndefined();
    expect(musicGenerationConfigSelectors.canSubmit(state('日系和风抒情流行，少女伤感'))).toBe(
      true,
    );
  });

  it('canSubmit accepts lyrics or style without a prompt but requires declared reference audio', () => {
    const base = { ...useMusicStore.getState(), parametersSchema: songSchema };

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

  it('canSubmit needs a selected model and some song input', () => {
    const state = useMusicStore.getState();
    const can = (model: string, parameters: Record<string, unknown>) =>
      musicGenerationConfigSelectors.canSubmit({
        ...state,
        model,
        parameters: parameters as any,
        parametersSchema: songSchema,
      });

    expect(can('', { prompt: 'a happy song' })).toBe(false);
    expect(can('song-model', { prompt: '  ' })).toBe(false);
    expect(can('song-model', { prompt: 'a happy song' })).toBe(true);
    expect(can('song-model', { prompt: '', style: 'pop' })).toBe(true);
    // Lyrics are not sent for an instrumental track, so they do not count as input
    expect(can('song-model', { instrumental: true, lyrics: 'words', prompt: '' })).toBe(false);
    expect(can('song-model', { lyrics: 'words', prompt: '' })).toBe(true);
  });

  it('reuses a previous batch config, ignoring params the model does not declare', () => {
    useMusicStore.getState().reuseMusicSettings('song-model', 'fal', {
      prompt: 'again',
      style: 'jazz',
      unknown: 1,
    } as any);

    const state = useMusicStore.getState();
    expect(state.model).toBe('song-model');
    expect(state.parameters).toMatchObject({ prompt: 'again', style: 'jazz' });
    expect(state.parameters).not.toHaveProperty('unknown');
  });
});
