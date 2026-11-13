import type { MusicModelParamsSchema, RuntimeMusicGenParams } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { musicService } from '@/services/music';
import { useMusicStore } from '@/store/music';

import { buildMusicRequestParams } from './action';

const { isGenerationPromptModerationErrorMock } = vi.hoisted(() => ({
  isGenerationPromptModerationErrorMock: vi.fn(),
}));

vi.mock('@/business/client/isGenerationPromptModerationError', () => ({
  isGenerationPromptModerationError: isGenerationPromptModerationErrorMock,
}));
vi.mock('@/business/client/handleLobeHubModelDeprecatedError', () => ({
  handleLobeHubModelDeprecatedError: vi.fn(),
}));
vi.mock('@/services/music', () => ({
  musicService: { createMusic: vi.fn() },
}));

const sunoSchema: MusicModelParamsSchema = {
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
      sunoSchema as Record<string, unknown>,
    );

    expect(params).toEqual({ prompt: 'lofi beat', style: 'jazz' });
  });

  it('drops lyrics from an instrumental request', () => {
    const params = buildMusicRequestParams(
      { instrumental: true, lyrics: '[Verse] hello', prompt: 'piano' },
      sunoSchema as Record<string, unknown>,
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
      model: 'suno-v6',
      parameters: { lyrics: '[Verse] neon rain', prompt: 'city pop', style: 'synthwave' },
      parametersSchema: sunoSchema,
      provider: 'suno',
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
      model: 'suno-v6',
      params: { lyrics: '[Verse] neon rain', prompt: 'city pop', style: 'synthwave' },
      provider: 'suno',
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
    model: 'music-cover',
    prompt: 'cover in jazz',
    provider: 'minimax',
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
      model: 'music-cover',
      params: { prompt: 'cover in jazz', referenceAudioUrl: 'https://s3.example.com/ref.mp3' },
      provider: 'minimax',
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
