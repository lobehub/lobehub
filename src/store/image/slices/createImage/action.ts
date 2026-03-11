import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';

import { markUserValidAction } from '@/business/client/markUserValidAction';
import { imageService } from '@/services/image';
import { type StoreSetter } from '@/store/types';

import { type ImageStore } from '../../store';
import { generationBatchSelectors } from '../generationBatch/selectors';
import { imageGenerationConfigSelectors } from '../generationConfig/selectors';
import { generationTopicSelectors } from '../generationTopic';

// ====== action interface ====== //

// ====== helper functions ====== //

// ====== action implementation ====== //

type Setter = StoreSetter<ImageStore>;
export const createCreateImageSlice = (set: Setter, get: () => ImageStore, _api?: unknown) =>
  new CreateImageActionImpl(set, get, _api);

export class CreateImageActionImpl {
  readonly #get: () => ImageStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ImageStore, _api?: unknown) {
    // keep signature aligned with StateCreator params: (set, get, api)
    void _api;
    this.#set = set;
    this.#get = get;
  }

  async createImage() {
    this.#set({ isCreating: true }, false, 'createImage/startCreateImage');

    const store = this.#get();
    const imageNum = imageGenerationConfigSelectors.imageNum(store);
    const parameters = imageGenerationConfigSelectors.parameters(store);
    const provider = imageGenerationConfigSelectors.provider(store);
    const model = imageGenerationConfigSelectors.model(store);
    const activeGenerationTopicId = generationTopicSelectors.activeGenerationTopicId(store);
    const { createGenerationTopic, switchGenerationTopic, setTopicBatchLoaded } = store;

    if (!parameters) {
      throw new TypeError('parameters is not initialized');
    }

    if (!parameters.prompt) {
      throw new TypeError('prompt is empty');
    }

    // Track the final topic ID to use for image creation
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
      // 4. If it's a new topic, set the creating state after topic creation
      if (isNewTopic) {
        this.#set(
          { isCreatingWithNewTopic: true },
          false,
          'createImage/startCreateImageWithNewTopic',
        );
      }

      if (ENABLE_BUSINESS_FEATURES) {
        markUserValidAction();
      }

      // 5. Create image via service
      await imageService.createImage({
        generationTopicId: finalTopicId!,
        provider,
        model,
        imageNum,
        params: parameters as any,
      });

      // 6. Only refresh generation batches if it's not a new topic
      if (!isNewTopic) {
        await this.#get().refreshGenerationBatches();
      }

      // 7. Clear the prompt input after successful image creation
      this.#set(
        (state) => ({
          parameters: { ...state.parameters, prompt: '' },
        }),
        false,
        'createImage/clearPrompt',
      );
    } finally {
      // 8. Reset all creating states
      if (isNewTopic) {
        this.#set(
          { isCreating: false, isCreatingWithNewTopic: false },
          false,
          'createImage/endCreateImageWithNewTopic',
        );
      } else {
        this.#set({ isCreating: false }, false, 'createImage/endCreateImage');
      }
    }
  }

  async recreateImage(generationBatchId: string) {
    this.#set({ isCreating: true }, false, 'recreateImage/startCreateImage');

    const store = this.#get();
    const activeGenerationTopicId = generationTopicSelectors.activeGenerationTopicId(store);
    if (!activeGenerationTopicId) {
      throw new Error('No active generation topic');
    }

    const { removeGenerationBatch } = store;
    const batch = generationBatchSelectors.getGenerationBatchByBatchId(generationBatchId)(store)!;

    // Use batch.generations.length to preserve original imageNum (not UI config)
    const imageNum = batch.generations.length;

    try {
      // 1. Delete generation batch
      await removeGenerationBatch(generationBatchId, activeGenerationTopicId);

      // 2. Create image via service
      await imageService.createImage({
        generationTopicId: activeGenerationTopicId,
        provider: batch.provider,
        model: batch.model,
        imageNum,
        params: batch.config as any,
      });

      // 3. Refresh generation batches to show the real data
      await store.refreshGenerationBatches();
    } finally {
      this.#set({ isCreating: false }, false, 'recreateImage/endCreateImage');
    }
  }
}

export type CreateImageAction = Pick<CreateImageActionImpl, keyof CreateImageActionImpl>;
