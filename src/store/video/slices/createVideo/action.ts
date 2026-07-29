import { t } from 'i18next';

import { handleGenerationPromptModerationError } from '@/business/client/handleGenerationPromptModerationError';
import { handleLobeHubModelDeprecatedError } from '@/business/client/handleLobeHubModelDeprecatedError';
import { message } from '@/components/AntdStaticMethods';
import { videoService } from '@/services/video';
import { type StoreSetter } from '@/store/types';

import { type VideoStore } from '../../store';
import { generationBatchSelectors } from '../generationBatch/selectors';
import { getVideoModelAndDefaults } from '../generationConfig/action';
import { videoGenerationConfigSelectors } from '../generationConfig/selectors';
import { generationTopicSelectors } from '../generationTopic';
import type { VideoEditingDraftSnapshot } from './initialState';

type Setter = StoreSetter<VideoStore>;

interface StartEditingVideoParams {
  generationId: string;
  model: string;
  provider: string;
  sourceParameters?: object;
}

const EDIT_INPUT_PARAMETER_KEYS = new Set([
  'endImageUrl',
  'imageUrl',
  'imageUrls',
  'prompt',
  'task',
]);

const cloneEditingDraft = (store: VideoStore): VideoEditingDraftSnapshot => ({
  model: store.model,
  parameters: {
    ...store.parameters,
    ...(store.parameters.imageUrls ? { imageUrls: [...store.parameters.imageUrls] } : {}),
  },
  parametersSchema: store.parametersSchema,
  provider: store.provider,
  uploadingImagePreviews: [...store.uploadingImagePreviews],
});

const restoreEditingDraft = (state: VideoStore) => {
  const snapshot = state.editingDraftSnapshot;

  if (!snapshot) {
    return { editingDraftSnapshot: undefined, editingGenerationId: undefined };
  }

  return {
    editingDraftSnapshot: undefined,
    editingGenerationId: undefined,
    model: snapshot.model,
    parameters: snapshot.parameters,
    parametersSchema: snapshot.parametersSchema,
    provider: snapshot.provider,
    uploadingImagePreviews: snapshot.uploadingImagePreviews,
  };
};

export const createCreateVideoSlice = (set: Setter, get: () => VideoStore, _api?: unknown) =>
  new CreateVideoActionImpl(set, get, _api);

export class CreateVideoActionImpl {
  readonly #get: () => VideoStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => VideoStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createVideo = async (): Promise<void> => {
    this.#set({ isCreating: true }, false, 'createVideo/startCreateVideo');

    const store = this.#get();
    const parameters = videoGenerationConfigSelectors.parameters(store);
    const provider = videoGenerationConfigSelectors.provider(store);
    const model = videoGenerationConfigSelectors.model(store);
    const activeGenerationTopicId = generationTopicSelectors.activeGenerationTopicId(store);
    const { createGenerationTopic, switchGenerationTopic, setTopicBatchLoaded } = store;

    if (!parameters) {
      throw new TypeError('parameters is not initialized');
    }

    if (!parameters.prompt) {
      throw new TypeError('prompt is empty');
    }

    // Validate: end frame requires start frame (driven by model schema)
    const parametersSchema = videoGenerationConfigSelectors.parametersSchema(store);
    const endImageUrlSchema = parametersSchema?.endImageUrl;
    if (
      endImageUrlSchema &&
      'requiresImageUrl' in endImageUrlSchema &&
      endImageUrlSchema.requiresImageUrl &&
      parameters.endImageUrl &&
      !parameters.imageUrl &&
      !parameters.imageUrls?.length
    ) {
      message.warning({
        content: t('generation.validation.endFrameRequiresStartFrame', { ns: 'video' }),
        duration: 3,
      });
      this.#set({ isCreating: false }, false, 'createVideo/endCreateVideo');
      return;
    }

    let finalTopicId = activeGenerationTopicId;

    // 1. Create generation topic if not exists
    const generationTopicId = activeGenerationTopicId;
    let isNewTopic = false;

    if (!generationTopicId) {
      isNewTopic = true;
      const prompts = [parameters.prompt];
      const newGenerationTopicId = await createGenerationTopic(prompts);
      finalTopicId = newGenerationTopicId;

      // 2. Initialize empty batch array to avoid skeleton screen
      setTopicBatchLoaded(newGenerationTopicId);

      // 3. Switch to the new topic (now it has empty data, so no skeleton screen)
      switchGenerationTopic(newGenerationTopicId);
    }

    try {
      // 3. If it's a new topic, set the creating state after topic creation
      if (isNewTopic) {
        this.#set(
          { isCreatingWithNewTopic: true },
          false,
          'createVideo/startCreateVideoWithNewTopic',
        );
      }

      // 4. Create video via service
      await videoService.createVideo({
        generationTopicId: finalTopicId!,
        model,
        params: parameters as any,
        previousGenerationId: store.editingGenerationId,
        provider,
      });

      // 5. Refresh generation batches to show the new batch
      if (!isNewTopic) {
        await this.#get().refreshGenerationBatches();
      }

      // 6. Restore the original draft after an edit, or clear a regular generation prompt
      this.#set(
        (state) =>
          state.editingGenerationId
            ? restoreEditingDraft(state)
            : { parameters: { ...state.parameters, prompt: '' } },
        false,
        'createVideo/clearPrompt',
      );
    } catch (error) {
      handleGenerationPromptModerationError(error);
      handleLobeHubModelDeprecatedError(error);
      throw error;
    } finally {
      // 7. Reset all creating states
      if (isNewTopic) {
        this.#set(
          { isCreating: false, isCreatingWithNewTopic: false },
          false,
          'createVideo/endCreateVideoWithNewTopic',
        );
      } else {
        this.#set({ isCreating: false }, false, 'createVideo/endCreateVideo');
      }
    }
  };

  cancelEditingVideo = (): void => {
    this.#set((state) => restoreEditingDraft(state), false, 'cancelEditingVideo');
  };

  recreateVideo = async (generationBatchId: string): Promise<void> => {
    this.#set({ isCreating: true }, false, 'recreateVideo/start');

    const store = this.#get();
    const activeGenerationTopicId = generationTopicSelectors.activeGenerationTopicId(store);
    if (!activeGenerationTopicId) {
      throw new Error('No active generation topic');
    }

    const { removeGenerationBatch } = store;
    const batch = generationBatchSelectors.getGenerationBatchByBatchId(generationBatchId)(store)!;

    try {
      await removeGenerationBatch(generationBatchId, activeGenerationTopicId);

      await videoService.createVideo({
        generationTopicId: activeGenerationTopicId,
        model: batch.model,
        params: batch.config as any,
        provider: batch.provider,
      });

      await store.refreshGenerationBatches();
    } catch (error) {
      handleGenerationPromptModerationError(error);
      handleLobeHubModelDeprecatedError(error);
      throw error;
    } finally {
      this.#set({ isCreating: false }, false, 'recreateVideo/end');
    }
  };

  startEditingVideo = ({
    generationId,
    model,
    provider,
    sourceParameters,
  }: StartEditingVideoParams): void => {
    const store = this.#get();
    const { defaultValues, parametersSchema } = getVideoModelAndDefaults(model, provider);
    const parameters = { ...defaultValues };

    for (const [key, value] of Object.entries(sourceParameters ?? {})) {
      if (!(key in parametersSchema) || EDIT_INPUT_PARAMETER_KEYS.has(key) || value === undefined) {
        continue;
      }

      Object.assign(parameters, { [key]: value });
    }

    this.#set(
      {
        editingDraftSnapshot: store.editingDraftSnapshot ?? cloneEditingDraft(store),
        editingGenerationId: generationId,
        model,
        parameters: { ...parameters, prompt: '' },
        parametersSchema,
        provider,
        uploadingImagePreviews: [],
      },
      false,
      `startEditingVideo/${generationId}`,
    );
  };
}

export type CreateVideoAction = Pick<CreateVideoActionImpl, keyof CreateVideoActionImpl>;
