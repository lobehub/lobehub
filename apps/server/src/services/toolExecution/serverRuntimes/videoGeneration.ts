import type { VideoGenerationModelSummary } from '@lobechat/builtin-tool-video-generation';
import { VideoGenerationIdentifier } from '@lobechat/builtin-tool-video-generation';
import { VideoGenerationExecutionRuntime } from '@lobechat/builtin-tool-video-generation/executionRuntime';
import type { AiProviderModelListItem, VideoModelParamsSchema } from 'model-bank';

import { aiModelRouter } from '@/server/routers/lambda/aiModel';
import { aiProviderRouter } from '@/server/routers/lambda/aiProvider';
import { generationRouter } from '@/server/routers/lambda/generation';
import { generationTopicRouter } from '@/server/routers/lambda/generationTopic';
import { videoRouter } from '@/server/routers/lambda/video';

import { type ServerRuntimeRegistration } from './types';

const normalizeModel = (model: AiProviderModelListItem): VideoGenerationModelSummary => ({
  description: model.description,
  displayName: model.displayName,
  id: model.id,
  parameters: model.parameters as VideoModelParamsSchema | undefined,
  pricing: model.pricing,
  releasedAt: model.releasedAt,
});

export const videoGenerationRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Video Generation tool execution');
    }

    const callerContext = {
      clientIp: context.clientIp,
      userId: context.userId,
      workspaceId: context.workspaceId,
    };
    const aiModelCaller = aiModelRouter.createCaller(callerContext);
    const aiProviderCaller = aiProviderRouter.createCaller(callerContext);
    const generationCaller = generationRouter.createCaller(callerContext);
    const generationTopicCaller = generationTopicRouter.createCaller(callerContext);
    const videoCaller = videoRouter.createCaller(callerContext);

    return new VideoGenerationExecutionRuntime({
      createGenerationTopic: (type, title) =>
        generationTopicCaller.createTopic({
          title,
          type,
          ...(context.agentVisibility === 'private' || context.agentVisibility === 'public'
            ? { visibility: context.agentVisibility }
            : {}),
        }),
      createVideo: (payload) => videoCaller.createVideo(payload),
      getGenerationStatus: async ({ asyncTaskId, generationId }) => {
        const result = await generationCaller.getGenerationStatus({ asyncTaskId, generationId });
        return {
          ...result,
          asyncTaskId,
          generationId,
        };
      },
      listVideoModels: async ({ provider, limit }) => {
        const runtimeState = await aiProviderCaller.getAiProviderRuntimeState({});
        const enabledProviders = provider
          ? runtimeState.enabledVideoAiProviders.filter((item) => item.id === provider)
          : runtimeState.enabledVideoAiProviders;
        const providers = await Promise.all(
          enabledProviders.map(async (item) => {
            const models = await aiModelCaller.getAiProviderModelList({
              enabled: true,
              id: item.id,
              limit,
              type: 'video',
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
  identifier: VideoGenerationIdentifier,
};
