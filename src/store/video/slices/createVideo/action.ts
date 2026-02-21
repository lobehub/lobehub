import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { t } from 'i18next';
import { type StateCreator } from 'zustand';

import { markUserValidAction } from '@/business/client/markUserValidAction';
import { message } from '@/components/AntdStaticMethods';
import { videoService } from '@/services/video';

import { type VideoStore } from '../../store';
import { generationBatchSelectors } from '../generationBatch/selectors';
import { videoGenerationConfigSelectors } from '../generationConfig/selectors';
import { generationTopicSelectors } from '../generationTopic';

// ====== action interface ====== //

export interface CreateVideoAction {
  createVideo: () => Promise<void>;
  recreateVideo: (generationBatchId: string) => Promise<void>;
}

// ====== action implementation ====== //

export const createCreateVideoSlice: StateCreator<
  VideoStore,
  [['zustand/devtools', never]],
  [],
  CreateVideoAction
> = (set, get) => ({
  async createVideo() {
    set({ isCreating: true }, false, 'createVideo/startCreateVideo');

    const store = get();
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
      !parameters.imageUrl
    ) {
      message.warning({
        content: t('generation.validation.endFrameRequiresStartFrame', { ns: 'video' }),
        duration: 3,
      });
      set({ isCreating: false }, false, 'createVideo/endCreateVideo');
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
        set({ isCreatingWithNewTopic: true }, false, 'createVideo/startCreateVideoWithNewTopic');
      }

      if (ENABLE_BUSINESS_FEATURES) {
        markUserValidAction();
      }

      // 4. Create video via service
      await videoService.createVideo({
        generationTopicId: finalTopicId!,
        model,
        params: parameters as any,
        provider,
      });

      // 5. Refresh generation batches to show the new batch
      if (!isNewTopic) {
        await get().refreshGenerationBatches();
      }

      // 6. Clear the prompt input after successful video creation
      set(
        (state) => ({
          parameters: { ...state.parameters, prompt: '' },
        }),
        false,
        'createVideo/clearPrompt',
      );
    } finally {
      // 7. Reset all creating states
      if (isNewTopic) {
        set(
          { isCreating: false, isCreatingWithNewTopic: false },
          false,
          'createVideo/endCreateVideoWithNewTopic',
        );
      } else {
        set({ isCreating: false }, false, 'createVideo/endCreateVideo');
      }
    }
  },

  async recreateVideo(generationBatchId: string) {
    set({ isCreating: true }, false, 'recreateVideo/start');

    const store = get();
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
    } finally {
      set({ isCreating: false }, false, 'recreateVideo/end');
    }
  },
});
