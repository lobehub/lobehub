import type { ImageGenerationModelSummary } from '@lobechat/builtin-tool-image-generation';
import { ImageGenerationIdentifier } from '@lobechat/builtin-tool-image-generation';
import { ImageGenerationExecutionRuntime } from '@lobechat/builtin-tool-image-generation/executionRuntime';
import type { AiProviderModelListItem } from 'model-bank';

import { aiModelRouter } from '@/server/routers/lambda/aiModel';
import { aiProviderRouter } from '@/server/routers/lambda/aiProvider';
import { generationRouter } from '@/server/routers/lambda/generation';
import { generationTopicRouter } from '@/server/routers/lambda/generationTopic';
import { imageRouter } from '@/server/routers/lambda/image';

import { type ServerRuntimeRegistration } from './types';

const normalizeModel = (model: AiProviderModelListItem): ImageGenerationModelSummary => ({
  displayName: model.displayName,
  id: model.id,
  parameters: model.parameters,
  pricing: model.pricing,
  releasedAt: model.releasedAt,
});

export const imageGenerationRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Image Generation tool execution');
    }

    const callerContext = { userId: context.userId };
    const aiModelCaller = aiModelRouter.createCaller(callerContext);
    const aiProviderCaller = aiProviderRouter.createCaller(callerContext);
    const generationCaller = generationRouter.createCaller(callerContext);
    const generationTopicCaller = generationTopicRouter.createCaller(callerContext);
    const imageCaller = imageRouter.createCaller(callerContext);

    return new ImageGenerationExecutionRuntime({
      createGenerationTopic: (type) => generationTopicCaller.createTopic({ type }),
      createImage: (payload) => imageCaller.createImage(payload),
      getGenerationStatus: async ({ asyncTaskId, generationId }) => {
        const result = await generationCaller.getGenerationStatus({ asyncTaskId, generationId });
        return {
          ...result,
          asyncTaskId,
          generationId,
        };
      },
      listImageModels: async ({ provider, limit }) => {
        if (provider) {
          const models = await aiModelCaller.getAiProviderModelList({
            enabled: true,
            id: provider,
            limit,
            type: 'image',
          });

          const providerModels = {
            id: provider,
            models: models.map(normalizeModel),
            name: provider,
          };

          return {
            providers: providerModels.models.length > 0 ? [providerModels] : [],
            totalModels: providerModels.models.length,
          };
        }

        const runtimeState = await aiProviderCaller.getAiProviderRuntimeState({});
        const providers = await Promise.all(
          runtimeState.enabledImageAiProviders.map(async (item) => {
            const models = await aiModelCaller.getAiProviderModelList({
              enabled: true,
              id: item.id,
              limit,
              type: 'image',
            });

            return {
              id: item.id,
              models: models.map(normalizeModel),
              name: item.name || item.id,
            };
          }),
        );
        const nonEmptyProviders = providers.filter((item) => item.models.length > 0);

        return {
          providers: nonEmptyProviders,
          totalModels: nonEmptyProviders.reduce((sum, item) => sum + item.models.length, 0),
        };
      },
    });
  },
  identifier: ImageGenerationIdentifier,
};
