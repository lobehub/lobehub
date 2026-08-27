import type { ImageGenerationModelSummary } from '@lobechat/builtin-tool-image-generation';
import { ImageGenerationIdentifier } from '@lobechat/builtin-tool-image-generation';
import { ImageGenerationExecutionRuntime } from '@lobechat/builtin-tool-image-generation/executionRuntime';
import type { AiProviderModelListItem } from 'model-bank';

import { aiModelRouter } from '@/server/routers/lambda/aiModel';
import { aiProviderRouter } from '@/server/routers/lambda/aiProvider';
import { generationRouter } from '@/server/routers/lambda/generation';
import { generationTopicRouter } from '@/server/routers/lambda/generationTopic';
import { imageRouter } from '@/server/routers/lambda/image';
import { toDelegationMarker } from '@/server/services/executionPrincipal';
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
    if (!context.principal.resourceOwnerUserId) {
      throw new Error('userId is required for Image Generation tool execution');
    }

    const delegationMarker = toDelegationMarker(context.principal);
    // Fail closed, mirroring `buildAgentShareModelRuntimeContext`: a marker
    // that exists but is missing a field means the upstream wiring is broken,
    // not that this is an ordinary run. Passing it on incomplete would let the
    // Cloud billing layer fall through to the creator's personal balance.
    if (delegationMarker && (!delegationMarker.agentId || !delegationMarker.visitorUserId)) {
      throw new Error(
        "Share-visitor image generation billing context is incomplete (missing agentId/visitorUserId); refusing to fall back to the creator's ordinary billing.",
      );
    }
    const callerContext = {
      clientIp: context.clientIp,
      userId: context.principal.resourceOwnerUserId,
      workspaceId: context.workspaceId,
      // Forward the share-visitor billing marker (narrowed to the two fields
      // the Cloud billing layer needs) so `imageCaller.createImage` bills the
      // creator's agentShare budget instead of `userId`'s ordinary balance —
      // dropping it here would silently charge the creator personally for a
      // share visitor's generation. See `AuthContext.agentShare`'s JSDoc
      // (`packages/trpc/src/lambda/context.ts`).
      ...(delegationMarker
        ? { agentShare: delegationMarker as { agentId: string; visitorUserId: string } }
        : {}),
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
      // Forward `context.topicId` (server-resolved from the running
      // operation, never model-suppliable) so the created async task/
      // generation row is tagged with the chat topic that requested it —
      // see `topicId`'s JSDoc on `createImageInputSchema`
      // (`apps/server/src/routers/lambda/image/index.ts`).
      createImage: (payload) => imageCaller.createImage({ ...payload, topicId: context.topicId }),
      // Same forwarding for the read side: without it, `getGenerationStatus`
      // would resolve ANY `generationId`/`asyncTaskId` scoped only by
      // `userId` (the creator, since a share run executes under the
      // creator's credentials — see `AgentShareGate`), letting a model reuse
      // or guess an id from a different topic/agent/visitor session and read
      // that generation's prompt and image. See `topicId`'s JSDoc on
      // `generationRouter.getGenerationStatus`
      // (`apps/server/src/routers/lambda/generation.ts`).
      getGenerationStatus: async ({ asyncTaskId, generationId }) => {
        const result = await generationCaller.getGenerationStatus({
          asyncTaskId,
          generationId,
          topicId: context.topicId,
        });
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
