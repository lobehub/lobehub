import { act, renderHook } from '@testing-library/react';
import type { AIVideoModelCard, RuntimeVideoGenParams, VideoModelParamsSchema } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { videoService } from '@/services/video';
import { useVideoStore } from '@/store/video';

const omniSchema: VideoModelParamsSchema = {
  aspectRatio: { default: '16:9', enum: ['16:9', '9:16'] },
  duration: { default: 10, max: 10, min: 10 },
  prompt: { default: '' },
};

const omniModel: AIVideoModelCard = {
  displayName: 'Gemini Omni Flash',
  id: 'gemini-omni-flash-preview',
  parameters: omniSchema,
  releasedAt: '2026-06-01',
  type: 'video',
};

vi.mock('@/business/client/handleGenerationPromptModerationError', () => ({
  handleGenerationPromptModerationError: vi.fn(),
}));
vi.mock('@/business/client/handleLobeHubModelDeprecatedError', () => ({
  handleLobeHubModelDeprecatedError: vi.fn(),
}));
vi.mock('@/services/video', () => ({
  videoService: {
    createVideo: vi.fn(),
  },
}));
vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    enabledVideoModelList: vi.fn(() => [
      {
        children: [omniModel],
        id: 'google',
        name: 'Google',
      },
    ]),
  },
  getAiInfraStoreState: vi.fn(() => ({})),
}));

describe('CreateVideoAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(videoService.createVideo).mockResolvedValue({ success: true } as any);

    useVideoStore.setState({
      activeGenerationTopicId: 'topic-1',
      editingDraftSnapshot: undefined,
      editingGenerationId: undefined,
      isCreating: false,
      isCreatingWithNewTopic: false,
      model: 'draft-model',
      parameters: {
        imageUrls: ['draft-reference.png'],
        prompt: 'An unrelated draft',
      } as RuntimeVideoGenParams,
      parametersSchema: { prompt: { default: '' } },
      provider: 'draft-provider',
      refreshGenerationBatches: vi.fn().mockResolvedValue(undefined),
      uploadingImagePreviews: ['blob:draft'],
    });
  });

  it('should start editing with a blank instruction and without source media', () => {
    const { result } = renderHook(() => useVideoStore());

    act(() => {
      result.current.startEditingVideo({
        generationId: 'generation-source',
        model: 'gemini-omni-flash-preview',
        provider: 'google',
        sourceParameters: {
          aspectRatio: '9:16',
          imageUrls: ['source-reference.png'],
          prompt: 'Original generation prompt',
        },
      });
    });

    expect(result.current.editingGenerationId).toBe('generation-source');
    expect(result.current.model).toBe('gemini-omni-flash-preview');
    expect(result.current.provider).toBe('google');
    expect(result.current.parameters).toEqual({
      aspectRatio: '9:16',
      duration: 10,
      prompt: '',
    });
    expect(result.current.uploadingImagePreviews).toEqual([]);
    expect(result.current.editingDraftSnapshot).toMatchObject({
      model: 'draft-model',
      parameters: {
        imageUrls: ['draft-reference.png'],
        prompt: 'An unrelated draft',
      },
      provider: 'draft-provider',
      uploadingImagePreviews: ['blob:draft'],
    });
  });

  it('should submit the source generation and restore the original draft after success', async () => {
    const { result } = renderHook(() => useVideoStore());

    act(() => {
      result.current.startEditingVideo({
        generationId: 'generation-source',
        model: 'gemini-omni-flash-preview',
        provider: 'google',
        sourceParameters: { aspectRatio: '9:16', prompt: 'Original generation prompt' },
      });
      result.current.setParamOnInput('prompt', 'Make the camera move more slowly');
    });

    await act(async () => {
      await result.current.createVideo();
    });

    expect(videoService.createVideo).toHaveBeenCalledWith({
      generationTopicId: 'topic-1',
      model: 'gemini-omni-flash-preview',
      params: {
        aspectRatio: '9:16',
        duration: 10,
        prompt: 'Make the camera move more slowly',
      },
      previousGenerationId: 'generation-source',
      provider: 'google',
    });
    expect(result.current.editingGenerationId).toBeUndefined();
    expect(result.current.editingDraftSnapshot).toBeUndefined();
    expect(result.current.model).toBe('draft-model');
    expect(result.current.parameters).toEqual({
      imageUrls: ['draft-reference.png'],
      prompt: 'An unrelated draft',
    });
    expect(result.current.uploadingImagePreviews).toEqual(['blob:draft']);
  });

  it('should preserve the edit instruction and edit state when creation fails', async () => {
    vi.mocked(videoService.createVideo).mockRejectedValueOnce(new Error('API failed'));
    const { result } = renderHook(() => useVideoStore());

    act(() => {
      result.current.startEditingVideo({
        generationId: 'generation-source',
        model: 'gemini-omni-flash-preview',
        provider: 'google',
      });
      result.current.setParamOnInput('prompt', 'Keep the subject still');
    });

    await expect(
      act(async () => {
        await result.current.createVideo();
      }),
    ).rejects.toThrow('API failed');

    expect(result.current.editingGenerationId).toBe('generation-source');
    expect(result.current.parameters.prompt).toBe('Keep the subject still');
  });

  it('should restore the original draft when editing is cancelled', () => {
    const { result } = renderHook(() => useVideoStore());

    act(() => {
      result.current.startEditingVideo({
        generationId: 'generation-source',
        model: 'gemini-omni-flash-preview',
        provider: 'google',
      });
      result.current.setParamOnInput('prompt', 'Temporary edit instruction');
      result.current.cancelEditingVideo();
    });

    expect(result.current.editingGenerationId).toBeUndefined();
    expect(result.current.editingDraftSnapshot).toBeUndefined();
    expect(result.current.model).toBe('draft-model');
    expect(result.current.provider).toBe('draft-provider');
    expect(result.current.parameters).toEqual({
      imageUrls: ['draft-reference.png'],
      prompt: 'An unrelated draft',
    });
  });
});
