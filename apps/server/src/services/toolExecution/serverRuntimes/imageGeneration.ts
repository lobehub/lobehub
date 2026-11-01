import type { ImageGenerationModelSummary } from '@lobechat/builtin-tool-image-generation';
import { ImageGenerationIdentifier } from '@lobechat/builtin-tool-image-generation';
import { ImageGenerationExecutionRuntime } from '@lobechat/builtin-tool-image-generation/executionRuntime';
import { RequestTrigger, toAgentShareVisitorIds } from '@lobechat/types';
import type { AiProviderModelListItem } from 'model-bank';

import { aiModelRouter } from '@/server/routers/lambda/aiModel';
import { aiProviderRouter } from '@/server/routers/lambda/aiProvider';
import { generationRouter } from '@/server/routers/lambda/generation';
import { generationTopicRouter } from '@/server/routers/lambda/generationTopic';
import { imageRouter } from '@/server/routers/lambda/image';
import { filterHiddenProviderModels } from '@/utils/aiProvider';

import { type ServerRuntimeRegistration } from './types';

const normalizeModel = (model: AiProviderModelListItem): ImageGenerationModelSummary => ({
  description: model.description,
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

    const callerContext = {
      clientIp: context.clientIp,
      /**
       * A share-visitor run executes under the shared agent's CREATOR, so the
       * image spend it triggers is indistinguishable from the creator's own
       * usage unless the origin is stamped on the charge. Projected fields
       * only — never spread `context.agentShareVisitor`, which also carries the
       * run's tool/memory permissions.
       */
      spendOrigin: context.agentShareVisitor
        ? {
            agentShare: toAgentShareVisitorIds(context.agentShareVisitor),
            trigger: RequestTrigger.AgentShare,
          }
        : undefined,
      userId: context.userId,
      workspaceId: context.workspaceId,
    };
    const aiModelCaller = aiModelRouter.createCaller(callerContext);
    const aiProviderCaller = aiProviderRouter.createCaller(callerContext);
    const generationCaller = generationRouter.createCaller(callerContext);
    const generationTopicCaller = generationTopicRouter.createCaller(callerContext);
    const imageCaller = imageRouter.createCaller(callerContext);

    return new ImageGenerationExecutionRuntime({
      createGenerationTopic: (type, title) =>
        generationTopicCaller.createTopic({
          title,
          type,
          ...(context.agentVisibility === 'private' || context.agentVisibility === 'public'
            ? { visibility: context.agentVisibility }
            : {}),
        }),
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
        const runtimeState = await aiProviderCaller.getAiProviderRuntimeState({});
        const enabledProviders = provider
          ? runtimeState.enabledImageAiProviders.filter((item) => item.id === provider)
          : runtimeState.enabledImageAiProviders;
        const providers = await Promise.all(
          enabledProviders.map(async (item) => {
            /**
             * Hidden models must be removed before applying the caller's limit, otherwise they
             * consume result slots and can make a provider appear empty despite later visible models.
             */
            const hasHiddenModels = runtimeState.hiddenBuiltinModels?.some(
              (model) => model.providerId === item.id,
            );
            const models = await aiModelCaller.getAiProviderModelList({
              enabled: true,
              id: item.id,
              limit: hasHiddenModels ? undefined : limit,
              type: 'image',
            });
            const visibleModels = filterHiddenProviderModels(
              models,
              item.id,
              runtimeState.hiddenBuiltinModels,
            );
            const limitedModels =
              typeof limit === 'number' ? visibleModels.slice(0, limit) : visibleModels;

            return {
              id: item.id,
              models: limitedModels.map(normalizeModel),
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
