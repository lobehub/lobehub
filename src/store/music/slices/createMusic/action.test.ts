import type { MusicModelParamsSchema, RuntimeMusicGenParams } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { musicService } from '@/services/music';
import { useMusicStore } from '@/store/music';

import { buildMusicRequestParams } from './action';

const { isGenerationPromptModerationErrorMock, toastErrorMock, toastInfoMock } = vi.hoisted(() => ({
  isGenerationPromptModerationErrorMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return { ...actual, toast: { ...actual.toast, error: toastErrorMock, info: toastInfoMock } };
});

vi.mock('@/business/client/isGenerationPromptModerationError', () => ({
  isGenerationPromptModerationError: isGenerationPromptModerationErrorMock,
}));
vi.mock('@/business/client/handleLobeHubModelDeprecatedError', () => ({
  handleLobeHubModelDeprecatedError: vi.fn(),
}));
vi.mock('@/services/music', () => ({
  musicService: { createMusic: vi.fn() },
}));

const songSchema: MusicModelParamsSchema = {
  instrumental: { default: false },
  lyrics: { default: null, maxLength: 5000 },
  prompt: { default: '', maxLength: 3000 },
  style: { default: null },
  title: { default: null },
};

describe('buildMusicRequestParams', () => {
  it('drops params the model does not declare and empty optional text', () => {
    const params = buildMusicRequestParams(
      {
        autoLyrics: true,
        lyrics: '   ',
        prompt: 'lofi beat',
        style: 'jazz',
        title: null,
      } as RuntimeMusicGenParams,
      songSchema as Record<string, unknown>,
    );

    expect(params).toEqual({ prompt: 'lofi beat', style: 'jazz' });
  });

  it('drops lyrics from an instrumental request', () => {
    const params = buildMusicRequestParams(
      { instrumental: true, lyrics: '[Verse] hello', prompt: 'piano' },
      songSchema as Record<string, unknown>,
    );

    expect(params).toEqual({ instrumental: true, prompt: 'piano' });
  });
});

describe('CreateMusicAction', () => {
  const refreshGenerationBatches = vi.fn().mockResolvedValue(undefined);
  const createGenerationTopic = vi.fn().mockResolvedValue('topic-new');
  const switchGenerationTopic = vi.fn();
  const setTopicBatchLoaded = vi.fn();
  const removeGenerationBatch = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(musicService.createMusic).mockResolvedValue({ success: true } as any);
    isGenerationPromptModerationErrorMock.mockReturnValue(false);

    useMusicStore.setState({
      activeGenerationTopicId: 'topic-1',
      blockedPrompt: undefined,
      createGenerationTopic,
      generationBatchesMap: {},
      isCreating: false,
      isCreatingWithNewTopic: false,
      model: 'song-model',
      parameters: { lyrics: '[Verse] neon rain', prompt: 'city pop', style: 'synthwave' },
      parametersSchema: songSchema,
      provider: 'fal',
      refreshGenerationBatches,
      removeGenerationBatch,
      retryingBatchIds: [],
      setTopicBatchLoaded,
      switchGenerationTopic,
    });
  });

  it('submits the draft to the active topic and keeps lyrics for the next variation', async () => {
    await useMusicStore.getState().createMusic();

    expect(musicService.createMusic).toHaveBeenCalledWith({
      generationTopicId: 'topic-1',
      model: 'song-model',
      params: { lyrics: '[Verse] neon rain', prompt: 'city pop', style: 'synthwave' },
      provider: 'fal',
    });
    expect(refreshGenerationBatches).toHaveBeenCalled();
    expect(createGenerationTopic).not.toHaveBeenCalled();

    const state = useMusicStore.getState();
    expect(state.parameters.prompt).toBe('');
    expect(state.parameters.lyrics).toBe('[Verse] neon rain');
    expect(state.isCreating).toBe(false);
  });

  it('creates a topic first when none is active, seeding its title from lyrics-only drafts', async () => {
    useMusicStore.setState({
      activeGenerationTopicId: null,
      parameters: { lyrics: 'only lyrics here', prompt: '' },
    });

    await useMusicStore.getState().createMusic();

    expect(createGenerationTopic).toHaveBeenCalledWith(['only lyrics here']);
    expect(setTopicBatchLoaded).toHaveBeenCalledWith('topic-new');
    expect(switchGenerationTopic).toHaveBeenCalledWith('topic-new');
    expect(musicService.createMusic).toHaveBeenCalledWith(
      expect.objectContaining({ generationTopicId: 'topic-new' }),
    );
    expect(useMusicStore.getState().isCreatingWithNewTopic).toBe(false);
  });

  it('marks the prompt as blocked when moderation rejects it and keeps the draft', async () => {
    const error = new Error('blocked');
    vi.mocked(musicService.createMusic).mockRejectedValueOnce(error);
    isGenerationPromptModerationErrorMock.mockReturnValueOnce(true);

    await expect(useMusicStore.getState().createMusic()).rejects.toThrow('blocked');

    const state = useMusicStore.getState();
    expect(state.blockedPrompt).toBe('city pop');
    expect(state.parameters.prompt).toBe('city pop');
    expect(state.isCreating).toBe(false);
    // The blocked notice on the input explains it; no second toast
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('tells the user why any other rejected submission failed, keeping the draft', async () => {
    vi.mocked(musicService.createMusic).mockRejectedValueOnce(
      new Error('Invalid music params: "prompt" needs at least 10 characters'),
    );

    await expect(useMusicStore.getState().createMusic()).rejects.toThrow('Invalid music params');

    // Before this, the error only reached the console and the generate button looked dead
    expect(toastErrorMock).toHaveBeenCalledWith('generation.submitFailed');
    expect(useMusicStore.getState().parameters.prompt).toBe('city pop');
  });

  it('treats a refresh failure after an accepted submission as started, not failed', async () => {
    refreshGenerationBatches.mockRejectedValueOnce(new Error('network down'));

    // Resolves: the server accepted the batch, so the user must not be invited to resubmit
    await expect(useMusicStore.getState().createMusic()).resolves.toBeUndefined();

    expect(musicService.createMusic).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(toastInfoMock).toHaveBeenCalledWith('generation.submittedRefreshFailed');
    expect(useMusicStore.getState().parameters.prompt).toBe('');
    expect(useMusicStore.getState().isCreating).toBe(false);
  });

  it('refuses a prompt shorter than the model minimum without calling the server', async () => {
    useMusicStore.setState({
      parameters: { prompt: '和风' },
      parametersSchema: { ...songSchema, prompt: { default: '', minLength: 10 } },
    });

    await expect(useMusicStore.getState().createMusic()).rejects.toThrow(TypeError);
    expect(musicService.createMusic).not.toHaveBeenCalled();
  });

  it('refuses an empty draft without calling the server', async () => {
    useMusicStore.setState({ parameters: { prompt: '  ' } });

    await expect(useMusicStore.getState().createMusic()).rejects.toThrow(TypeError);
    expect(musicService.createMusic).not.toHaveBeenCalled();
  });

  const coverBatch = (generations: any[]) => ({
    config: {
      prompt: 'cover in jazz',
      referenceAudioUrl: 'https://s3.example.com/ref.mp3',
    } as any,
    createdAt: new Date(),
    generations,
    id: 'batch-1',
    model: 'cover-model',
    prompt: 'cover in jazz',
    provider: 'acme',
  });
  const song = (id: string, status: string) => ({ id, task: { id: `task-${id}`, status } });

  it('retries by resubmitting the stored config, then removes only the failed songs', async () => {
    const removeGeneration = vi.fn().mockResolvedValue(undefined);
    useMusicStore.setState({
      generationBatchesMap: {
        'topic-1': [coverBatch([song('ok', 'success'), song('bad', 'error')])] as any,
      },
      removeGeneration,
    });

    await useMusicStore.getState().recreateMusic('batch-1');

    expect(musicService.createMusic).toHaveBeenCalledWith({
      generationTopicId: 'topic-1',
      model: 'cover-model',
      params: { prompt: 'cover in jazz', referenceAudioUrl: 'https://s3.example.com/ref.mp3' },
      provider: 'acme',
    });
    // The successful sibling survives the retry
    expect(removeGeneration).toHaveBeenCalledTimes(1);
    expect(removeGeneration).toHaveBeenCalledWith('bad');
    expect(removeGenerationBatch).not.toHaveBeenCalled();
    expect(vi.mocked(musicService.createMusic).mock.invocationCallOrder[0]).toBeLessThan(
      removeGeneration.mock.invocationCallOrder[0],
    );
    expect(useMusicStore.getState().retryingBatchIds).toEqual([]);
  });

  it('keeps the failed batch when the resubmission is rejected', async () => {
    const removeGeneration = vi.fn().mockResolvedValue(undefined);
    useMusicStore.setState({
      generationBatchesMap: { 'topic-1': [coverBatch([song('bad', 'error')])] as any },
      removeGeneration,
    });
    vi.mocked(musicService.createMusic).mockRejectedValueOnce(new Error('BAD_REQUEST'));

    await expect(useMusicStore.getState().recreateMusic('batch-1')).rejects.toThrow('BAD_REQUEST');

    expect(removeGeneration).not.toHaveBeenCalled();
    expect(useMusicStore.getState().retryingBatchIds).toEqual([]);
  });
});
