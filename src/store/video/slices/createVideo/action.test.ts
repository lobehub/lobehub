import { act, renderHook } from '@testing-library/react';
import type { AIVideoModelCard, RuntimeVideoGenParams, VideoModelParamsSchema } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useVideoReferenceUpload } from '@/routes/(main)/(create)/video/features/PromptInput/useVideoReferenceUpload';
import { videoService } from '@/services/video';
import { useVideoStore } from '@/store/video';

import { videoGenerationConfigSelectors } from '../generationConfig/selectors';

const omniSchema: VideoModelParamsSchema = {
  aspectRatio: { default: '16:9', enum: ['16:9', '9:16'] },
  duration: { default: 10, max: 10, min: 10 },
  prompt: { default: '' },
};

const omniModel: AIVideoModelCard = {
  displayName: 'Gemini Omni Flash',
  id: 'gemini-omni-1.1-flash',
  parameters: omniSchema,
  releasedAt: '2026-06-01',
  type: 'video',
};

const omni12Model: AIVideoModelCard = {
  ...omniModel,
  id: 'gemini-omni-1.2-flash',
  parameters: {
    ...omniSchema,
    endImageUrl: { default: null },
    imageUrl: { default: null },
    imageUrls: { default: [], maxCount: 6 },
  },
};

const { isGenerationPromptModerationErrorMock, uploadWithProgressMock } = vi.hoisted(() => ({
  isGenerationPromptModerationErrorMock: vi.fn(),
  uploadWithProgressMock: vi.fn(),
}));

vi.mock('@/business/client/isGenerationPromptModerationError', () => ({
  isGenerationPromptModerationError: isGenerationPromptModerationErrorMock,
}));
vi.mock('@/business/client/handleLobeHubModelDeprecatedError', () => ({
  handleLobeHubModelDeprecatedError: vi.fn(),
}));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));
vi.mock('@/store/file', () => ({
  useFileStore: (
    selector: (state: { uploadWithProgress: typeof uploadWithProgressMock }) => unknown,
  ) => selector({ uploadWithProgress: uploadWithProgressMock }),
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
        children: [omniModel, omni12Model],
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
      blockedPrompt: undefined,
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
      uploadingImagePreviews: [],
    });
  });

  it('should start editing with a blank instruction and without source media', () => {
    const { result } = renderHook(() => useVideoStore());

    act(() => {
      result.current.startEditingVideo({
        generationId: 'generation-source',
        model: 'gemini-omni-1.1-flash',
        provider: 'google',
        sourceParameters: {
          aspectRatio: '9:16',
          imageUrls: ['source-reference.png'],
          prompt: 'Original generation prompt',
        },
      });
    });

    expect(result.current.editingGenerationId).toBe('generation-source');
    expect(result.current.model).toBe('gemini-omni-1.1-flash');
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
    });
  });

  it('starts an Omni 1.2 edit with an empty reference slot and restores the draft on cancellation', () => {
    const draft = useVideoStore.getState();
    draft.startEditingVideo({
      generationId: 'generation-source',
      model: omni12Model.id,
      provider: 'google',
      sourceParameters: { imageUrls: ['source-reference.png'], prompt: 'Source video' },
    });

    const edit = useVideoStore.getState();
    const slot = videoGenerationConfigSelectors.isImageInputSlotEnabled;
    expect(edit.imageInputMode).toBe('reference');
    expect(edit.parameters.imageUrls).toEqual([]);
    expect(slot('imageUrls')(edit)).toBe(true);
    expect(slot('imageUrl')(edit)).toBe(false);
    expect(slot('endImageUrl')(edit)).toBe(false);

    edit.cancelEditingVideo();
    expect(useVideoStore.getState().parameters).toEqual(draft.parameters);
  });

  it('should submit the source generation and restore the original draft after success', async () => {
    const { result } = renderHook(() => useVideoStore());

    act(() => {
      result.current.startEditingVideo({
        generationId: 'generation-source',
        model: 'gemini-omni-1.1-flash',
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
      model: 'gemini-omni-1.1-flash',
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
    expect(result.current.uploadingImagePreviews).toEqual([]);
  });

  describe('pending reference uploads', () => {
    const source = { generationId: 'generation-source', model: omni12Model.id, provider: 'google' };

    const deferUpload = (preview: string) => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce(preview);
      let finish!: (result: { url: string }) => void;
      uploadWithProgressMock.mockReturnValueOnce(
        new Promise<{ url: string }>((resolve) => {
          finish = resolve;
        }),
      );
      return finish;
    };

    const image = new File(['fixture'], 'reference.png', { type: 'image/png' });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('waits for the reference before submitting the edit', async () => {
      const edit = useVideoStore.getState();
      edit.startEditingVideo(source);
      edit.setParamOnInput('prompt', 'Use the new reference');
      const { result } = renderHook(useVideoReferenceUpload);
      const finish = deferUpload('blob:edit-reference');
      let upload!: Promise<void>;
      act(() => {
        upload = result.current.handleUploadFiles([image]);
      });

      await act(() => useVideoStore.getState().createVideo());
      const attemptsWhilePending = vi.mocked(videoService.createVideo).mock.calls.length;
      await act(async () => {
        finish({ url: 'https://storage.example/edit-reference.png' });
        await upload;
      });

      expect(attemptsWhilePending).toBe(0);
      expect(useVideoStore.getState().uploadingImagePreviews).toEqual([]);

      await act(() => useVideoStore.getState().createVideo());
      expect(videoService.createVideo).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          params: expect.objectContaining({
            imageUrls: ['https://storage.example/edit-reference.png'],
          }),
          previousGenerationId: source.generationId,
        }),
      );
    });

    it('drops a cancelled upload after the same source is reopened', async () => {
      useVideoStore.getState().startEditingVideo(source);
      const { result } = renderHook(useVideoReferenceUpload);
      const finishCancelled = deferUpload('blob:cancelled-reference');
      let cancelled!: Promise<void>;
      act(() => {
        cancelled = result.current.handleUploadFiles([image]);
      });

      act(() => {
        useVideoStore.getState().cancelEditingVideo();
        useVideoStore.getState().startEditingVideo(source);
      });
      const finishCurrent = deferUpload('blob:current-reference');
      let current!: Promise<void>;
      act(() => {
        current = result.current.handleUploadFiles([image]);
      });

      await act(async () => {
        finishCancelled({ url: 'https://storage.example/cancelled-reference.png' });
        await cancelled;
      });
      const stillPending = useVideoStore.getState().uploadingImagePreviews;
      await act(async () => {
        finishCurrent({ url: 'https://storage.example/current-reference.png' });
        await current;
      });

      expect(stillPending).toEqual(['blob:current-reference']);
      expect(useVideoStore.getState().uploadingImagePreviews).toEqual([]);
      expect(useVideoStore.getState().parameters.imageUrls).toEqual([
        'https://storage.example/current-reference.png',
      ]);
    });

    it.each(['imageUrl', 'endImageUrl'] as const)(
      'tracks a replacement upload and updates only %s',
      async (frame) => {
        const original = {
          endImageUrl: 'https://storage.example/end.png',
          imageUrl: 'https://storage.example/start.png',
          prompt: 'Original draft',
        };
        useVideoStore.setState({
          imageInputMode: 'frames',
          model: omni12Model.id,
          parameters: original,
          parametersSchema: omni12Model.parameters,
          provider: 'google',
        });
        const { result } = renderHook(useVideoReferenceUpload);
        const finish = deferUpload('blob:frame-replacement');
        let upload!: Promise<void>;
        act(() => {
          upload = result.current.handleUploadFrameFiles([image], frame);
        });

        expect(useVideoStore.getState().uploadingImagePreviews).toEqual(['blob:frame-replacement']);
        await act(() => useVideoStore.getState().createVideo());
        expect(videoService.createVideo).not.toHaveBeenCalled();
        const url = 'https://storage.example/replacement.png';
        await act(async () => {
          finish({ url });
          await upload;
        });

        expect(useVideoStore.getState().uploadingImagePreviews).toEqual([]);
        expect(useVideoStore.getState().parameters).toEqual({ ...original, [frame]: url });
      },
    );

    it.each([
      {
        destination: 'a new topic',
        navigate: () => useVideoStore.getState().openNewGenerationTopic(),
        topicId: null,
      },
      {
        destination: 'another topic',
        navigate: () => useVideoStore.getState().switchGenerationTopic('topic-2'),
        topicId: 'topic-2',
      },
    ])(
      'restores the creation draft when leaving an edit for $destination',
      async ({ navigate, topicId }) => {
        const store = useVideoStore.getState();
        store.startEditingVideo(source);
        store.setParamOnInput('prompt', 'An edit instruction');
        store.setParamOnInput('imageUrls', ['completed-edit-reference.png']);
        const { result } = renderHook(useVideoReferenceUpload);
        const finish = deferUpload('blob:topic-edit-reference');
        let upload!: Promise<void>;
        act(() => {
          upload = result.current.handleUploadFiles([image]);
        });
        const pendingInEdit = useVideoStore.getState().uploadingImagePreviews;

        act(navigate);
        const afterNavigation = useVideoStore.getState();
        await act(async () => {
          finish({ url: 'https://storage.example/late-edit-reference.png' });
          await upload;
        });

        expect(pendingInEdit).toEqual(['blob:topic-edit-reference']);
        expect(afterNavigation).toMatchObject({
          activeGenerationTopicId: topicId,
          editingDraftSnapshot: undefined,
          editingGenerationId: undefined,
          model: 'draft-model',
          uploadingImagePreviews: [],
        });
        expect(useVideoStore.getState().parameters).toEqual({
          imageUrls: ['draft-reference.png'],
          prompt: 'An unrelated draft',
        });
      },
    );

    it('keeps an upload in the shared creation draft while navigating topics', async () => {
      useVideoStore.setState({
        imageInputMode: 'reference',
        model: omni12Model.id,
        parametersSchema: omni12Model.parameters,
        provider: 'google',
      });
      const { result } = renderHook(useVideoReferenceUpload);
      const finish = deferUpload('blob:creation-reference');
      let upload!: Promise<void>;
      act(() => {
        const store = useVideoStore.getState();
        upload = result.current.handleUploadFiles([image]);
        store.switchGenerationTopic('topic-2');
        store.openNewGenerationTopic();
      });
      const pendingAfterNavigation = useVideoStore.getState().uploadingImagePreviews;

      await act(async () => {
        finish({ url: 'https://storage.example/creation-reference.png' });
        await upload;
      });

      expect(pendingAfterNavigation).toEqual(['blob:creation-reference']);
      expect(useVideoStore.getState().parameters.imageUrls).toEqual([
        'draft-reference.png',
        'https://storage.example/creation-reference.png',
      ]);
    });

    it.each([
      { draft: 'an edit', editing: true },
      { draft: 'a creation', editing: false },
    ])(
      'keeps reused references when an upload from $draft draft finishes late',
      async ({ editing }) => {
        useVideoStore.setState({
          imageInputMode: 'reference',
          model: omni12Model.id,
          parametersSchema: omni12Model.parameters,
          provider: 'google',
        });
        const store = useVideoStore.getState();
        if (editing) store.startEditingVideo(source);
        const { result } = renderHook(useVideoReferenceUpload);
        const finish = deferUpload('blob:replaced-reference');
        let upload!: Promise<void>;
        act(() => {
          upload = result.current.handleUploadFiles([image]);
          store.reuseVideoSettings(omni12Model.id, 'google', {
            imageUrls: ['reused-reference.png'],
            prompt: 'A saved prompt',
          });
        });

        await act(async () => {
          finish({ url: 'https://storage.example/late-replaced-reference.png' });
          await upload;
        });

        expect(useVideoStore.getState().editingGenerationId).toBeUndefined();
        expect(useVideoStore.getState().parameters).toMatchObject({
          imageUrls: ['reused-reference.png'],
          prompt: 'A saved prompt',
        });
      },
    );

    it('uses creation references when selecting a model while editing', async () => {
      useVideoStore.setState({ imageInputMode: 'reference' });
      const store = useVideoStore.getState();
      store.startEditingVideo(source);
      store.setParamOnInput('imageUrls', ['completed-edit-reference.png']);
      store.setParamOnInput('prompt', 'An edit instruction');
      const { result } = renderHook(useVideoReferenceUpload);
      const finish = deferUpload('blob:edit-model-reference');
      let upload!: Promise<void>;
      act(() => {
        upload = result.current.handleUploadFiles([image]);
        store.setModelAndProviderOnSelect(omni12Model.id, 'google');
      });

      await act(async () => {
        finish({ url: 'https://storage.example/late-edit-model-reference.png' });
        await upload;
      });

      expect(useVideoStore.getState().editingGenerationId).toBeUndefined();
      expect(useVideoStore.getState().parameters).toMatchObject({
        imageUrls: ['draft-reference.png'],
        prompt: 'An unrelated draft',
      });
    });

    it('restores completed draft references without reviving stale previews', async () => {
      useVideoStore.setState({
        imageInputMode: 'reference',
        model: omni12Model.id,
        parametersSchema: omni12Model.parameters,
        provider: 'google',
        uploadingImagePreviews: [],
      });
      const { result } = renderHook(useVideoReferenceUpload);
      const finish = deferUpload('blob:original-pending');
      let upload!: Promise<void>;
      act(() => {
        upload = result.current.handleUploadFiles([image]);
      });
      act(() => {
        useVideoStore.getState().startEditingVideo(source);
      });
      await act(async () => {
        finish({ url: 'https://storage.example/original-pending.png' });
        await upload;
      });
      act(() => {
        useVideoStore.getState().cancelEditingVideo();
      });

      expect(useVideoStore.getState().uploadingImagePreviews).toEqual([]);
      expect(useVideoStore.getState().parameters).toMatchObject({
        imageUrls: ['draft-reference.png'],
        prompt: 'An unrelated draft',
      });
    });
  });

  describe('submitted draft cleanup', () => {
    const source = { generationId: 'generation-source', model: omni12Model.id, provider: 'google' };

    const submitEdit = () => {
      const store = useVideoStore.getState();
      store.startEditingVideo(source);
      store.setParamOnInput('prompt', 'The submitted edit');
      const result = { success: true } as Awaited<ReturnType<typeof videoService.createVideo>>;
      let complete!: () => void;
      let reject!: (error: Error) => void;
      vi.mocked(videoService.createVideo).mockReturnValueOnce(
        new Promise((resolve, rejectRequest) => {
          complete = () => resolve(result);
          reject = rejectRequest;
        }),
      );
      return { complete, reject, submitting: store.createVideo() };
    };

    it('restores the creation draft after a successful edit of the current draft', async () => {
      const { complete, submitting } = submitEdit();
      complete();
      await submitting;

      expect(useVideoStore.getState().editingGenerationId).toBeUndefined();
      expect(useVideoStore.getState().parameters.prompt).toBe('An unrelated draft');
    });

    it('preserves the restored creation draft after a submitted edit completes', async () => {
      const { complete, submitting } = submitEdit();
      useVideoStore.getState().switchGenerationTopic('topic-2');
      complete();
      await submitting;

      expect(useVideoStore.getState().parameters).toEqual({
        imageUrls: ['draft-reference.png'],
        prompt: 'An unrelated draft',
      });
    });

    it('preserves a new edit of the same source after an earlier submission completes', async () => {
      const { complete, submitting } = submitEdit();
      const store = useVideoStore.getState();
      store.cancelEditingVideo();
      store.startEditingVideo(source);
      store.setParamOnInput('prompt', 'The next edit');
      complete();
      await submitting;

      expect(useVideoStore.getState().editingGenerationId).toBe(source.generationId);
      expect(useVideoStore.getState().parameters.prompt).toBe('The next edit');
    });

    it('keeps a stale moderation result out of the draft restored by topic navigation', async () => {
      isGenerationPromptModerationErrorMock.mockReturnValueOnce(true);
      const { reject, submitting } = submitEdit();
      useVideoStore.getState().openNewGenerationTopic();
      reject(new Error('blocked'));
      await expect(submitting).rejects.toThrow('blocked');

      expect(useVideoStore.getState().blockedPrompt).toBeUndefined();
      expect(useVideoStore.getState().parameters.prompt).toBe('An unrelated draft');
    });

    it('keeps a reference selected while the edit submission is pending', async () => {
      const { complete, submitting } = submitEdit();
      const { result } = renderHook(useVideoReferenceUpload);
      const preview = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:later-reference');
      let uploaded!: (value: { url: string }) => void;
      uploadWithProgressMock.mockReturnValueOnce(
        new Promise<{ url: string }>((resolve) => {
          uploaded = resolve;
        }),
      );
      const image = new File(['fixture'], 'reference.png', { type: 'image/png' });
      let upload!: Promise<void>;

      try {
        act(() => {
          upload = result.current.handleUploadFiles([image]);
        });
        expect(useVideoStore.getState().uploadingImagePreviews).toContain('blob:later-reference');

        await act(async () => {
          complete();
          await submitting;
        });
        await act(async () => {
          uploaded({ url: 'https://storage.example/later-reference.png' });
          await upload;
        });

        expect(useVideoStore.getState().editingGenerationId).toBe(source.generationId);
        expect(useVideoStore.getState().parameters.imageUrls).toEqual([
          'https://storage.example/later-reference.png',
        ]);
      } finally {
        preview.mockRestore();
      }
    });

    it('shows the moderation notice after changing only the aspect ratio', async () => {
      isGenerationPromptModerationErrorMock.mockReturnValueOnce(true);
      const { reject, submitting } = submitEdit();
      useVideoStore.getState().setParamOnInput('aspectRatio', '9:16');
      expect(useVideoStore.getState().parameters.aspectRatio).toBe('9:16');

      reject(new Error('blocked'));
      await expect(submitting).rejects.toThrow('blocked');

      expect(useVideoStore.getState().blockedPrompt).toBe('The submitted edit');
    });

    it('does not show a stale moderation notice when switching back to the same source', async () => {
      isGenerationPromptModerationErrorMock.mockReturnValueOnce(true);
      const { reject, submitting } = submitEdit();
      const store = useVideoStore.getState();
      store.startEditingVideo({ ...source, generationId: 'another-source' });
      store.startEditingVideo(source);
      expect(useVideoStore.getState().parameters.prompt).toBe('The submitted edit');

      reject(new Error('blocked'));
      await expect(submitting).rejects.toThrow('blocked');

      expect(useVideoStore.getState().blockedPrompt).toBeUndefined();
    });

    it('does not show a stale moderation notice after changing the instruction', async () => {
      isGenerationPromptModerationErrorMock.mockReturnValueOnce(true);
      const { reject, submitting } = submitEdit();
      useVideoStore.getState().setParamOnInput('prompt', 'A different instruction');

      reject(new Error('blocked'));
      await expect(submitting).rejects.toThrow('blocked');

      expect(useVideoStore.getState().blockedPrompt).toBeUndefined();
    });

    it.each([
      [
        'switching the edit source',
        () =>
          useVideoStore.getState().startEditingVideo({
            ...source,
            generationId: 'another-source',
          }),
      ],
      ['cancelling the edit', () => useVideoStore.getState().cancelEditingVideo()],
      [
        'leaving the edit through the model picker',
        () => useVideoStore.getState().setModelAndProviderOnSelect(omni12Model.id, 'google'),
      ],
      [
        'reusing settings',
        () =>
          useVideoStore.getState().reuseVideoSettings(omni12Model.id, 'google', {
            prompt: 'The submitted edit',
          }),
      ],
    ] as const)(
      'clears an existing moderation notice after %s with the same instruction',
      async (_, changeDraft) => {
        useVideoStore.getState().setParamOnInput('prompt', 'The submitted edit');
        isGenerationPromptModerationErrorMock.mockReturnValueOnce(true);
        const { reject, submitting } = submitEdit();

        reject(new Error('blocked'));
        await expect(submitting).rejects.toThrow('blocked');
        expect(useVideoStore.getState().blockedPrompt).toBe('The submitted edit');

        changeDraft();

        expect(useVideoStore.getState().parameters.prompt).toBe('The submitted edit');
        expect(useVideoStore.getState().blockedPrompt).toBeUndefined();
      },
    );

    it('clears the prompt after submitting the current creation draft', async () => {
      await useVideoStore.getState().createVideo();
      expect(useVideoStore.getState().parameters.prompt).toBe('');
    });
  });

  it('should preserve the edit instruction and edit state when creation fails', async () => {
    vi.mocked(videoService.createVideo).mockRejectedValueOnce(new Error('API failed'));
    const { result } = renderHook(() => useVideoStore());

    act(() => {
      result.current.startEditingVideo({
        generationId: 'generation-source',
        model: 'gemini-omni-1.1-flash',
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

  it('should keep a moderation-rejected prompt for the inline notice and clear it on resubmit', async () => {
    vi.mocked(videoService.createVideo).mockRejectedValueOnce(new Error('blocked'));
    isGenerationPromptModerationErrorMock.mockReturnValueOnce(true);

    await expect(useVideoStore.getState().createVideo()).rejects.toThrow('blocked');
    expect(useVideoStore.getState().blockedPrompt).toBe('An unrelated draft');
    expect(useVideoStore.getState().parameters?.prompt).toBe('An unrelated draft');

    await useVideoStore.getState().createVideo();
    expect(useVideoStore.getState().blockedPrompt).toBeUndefined();
  });

  it('should not mark the prompt as blocked for other errors', async () => {
    vi.mocked(videoService.createVideo).mockRejectedValueOnce(new Error('Service error'));

    await expect(useVideoStore.getState().createVideo()).rejects.toThrow('Service error');
    expect(useVideoStore.getState().blockedPrompt).toBeUndefined();
  });

  it('should restore the original draft when editing is cancelled', () => {
    const { result } = renderHook(() => useVideoStore());

    act(() => {
      result.current.startEditingVideo({
        generationId: 'generation-source',
        model: 'gemini-omni-1.1-flash',
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

  it('should keep the typed instruction when switching to another edit source', () => {
    const { result } = renderHook(() => useVideoStore());

    act(() => {
      result.current.startEditingVideo({
        generationId: 'generation-a',
        model: 'gemini-omni-1.1-flash',
        provider: 'google',
      });
      result.current.setParamOnInput('prompt', 'Make the camera move more slowly');
      result.current.startEditingVideo({
        generationId: 'generation-b',
        model: 'gemini-omni-1.1-flash',
        provider: 'google',
      });
    });

    expect(result.current.editingGenerationId).toBe('generation-b');
    expect(result.current.parameters.prompt).toBe('Make the camera move more slowly');
    expect(result.current.editingDraftSnapshot?.parameters.prompt).toBe('An unrelated draft');
  });

  it('should leave edit mode and restore the draft when the edit source is deleted', async () => {
    useVideoStore.setState({
      generationBatchesMap: {},
      internal_deleteGeneration: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useVideoStore());

    act(() => {
      result.current.startEditingVideo({
        generationId: 'generation-source',
        model: 'gemini-omni-1.1-flash',
        provider: 'google',
      });
    });

    await act(async () => {
      await result.current.removeGeneration('generation-source');
    });

    expect(result.current.editingGenerationId).toBeUndefined();
    expect(result.current.model).toBe('draft-model');
    expect(result.current.parameters.prompt).toBe('An unrelated draft');
  });

  it('should leave edit mode when the batch holding the edit source is deleted', async () => {
    useVideoStore.setState({
      generationBatchesMap: {
        'topic-1': [{ generations: [{ id: 'generation-source' }], id: 'batch-source' } as any],
      },
      internal_deleteGenerationBatch: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useVideoStore());

    act(() => {
      result.current.startEditingVideo({
        generationId: 'generation-source',
        model: 'gemini-omni-1.1-flash',
        provider: 'google',
      });
    });

    await act(async () => {
      await result.current.removeGenerationBatch('batch-source', 'topic-1');
    });

    expect(result.current.editingGenerationId).toBeUndefined();
    expect(result.current.model).toBe('draft-model');
  });
});
