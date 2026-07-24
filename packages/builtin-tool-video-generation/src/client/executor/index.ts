import type {
  BuiltinServerRuntimeOutput,
  BuiltinToolContext,
  BuiltinToolResult,
} from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import type { AiModelForSelect, AiProviderModelListItem, VideoModelParamsSchema } from 'model-bank';

import { aiModelService } from '@/services/aiModel';
import { aiProviderService } from '@/services/aiProvider';
import { generationService } from '@/services/generation';
import { generationTopicService } from '@/services/generationTopic';
import { videoService } from '@/services/video';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';

import { VideoGenerationExecutionRuntime } from '../../ExecutionRuntime';
import { VideoGenerationManifest } from '../../manifest';
import type {
  GenerateVideoParams,
  GetVideoGenerationStatusParams,
  GetVideoModelParametersParams,
  ListVideoModelsParams,
  VideoGenerationModelSummary,
  VideoGenerationProviderModels,
} from '../../types';
import { VideoGenerationApiName } from '../../types';

const normalizeStoreModel = (model: AiModelForSelect): VideoGenerationModelSummary => ({
  approximatePricePerVideo: model.approximatePricePerVideo,
  description: model.description,
  displayName: model.displayName,
  id: model.id,
  parameters: model.parameters as VideoModelParamsSchema | undefined,
  pricePerVideo: model.pricePerVideo,
  pricing: model.pricing,
  releasedAt: model.releasedAt,
});

const normalizeRawModel = (model: AiProviderModelListItem): VideoGenerationModelSummary => ({
  description: model.description,
  displayName: model.displayName,
  id: model.id,
  parameters: model.parameters as VideoModelParamsSchema | undefined,
  pricing: model.pricing,
  releasedAt: model.releasedAt,
});

const toLimitedProviders = (
  providers: VideoGenerationProviderModels[],
  limit: number,
): VideoGenerationProviderModels[] =>
  providers.map((provider) => ({ ...provider, models: provider.models.slice(0, limit) }));

const createClientVideoGenerationRuntime = (topicVisibility?: 'private' | 'public') => {
  return new VideoGenerationExecutionRuntime({
    createGenerationTopic: (type, title) =>
      generationTopicService.createTopic(type, topicVisibility, title),
    createVideo: (payload) => videoService.createVideo(payload),
    getGenerationStatus: async ({ asyncTaskId, generationId }) => {
      const result = await generationService.getGenerationStatus(generationId, asyncTaskId);
      return {
        ...result,
        asyncTaskId,
        generationId,
      };
    },
    listVideoModels: async ({ provider, limit }) => {
      const storeProviders = aiProviderSelectors.enabledVideoModelList(getAiInfraStoreState());
      const filteredStoreProviders = provider
        ? storeProviders.filter((item) => item.id === provider)
        : storeProviders;

      const mappedStoreProviders: VideoGenerationProviderModels[] = filteredStoreProviders
        .map((item) => ({
          id: item.id,
          models: item.children.map(normalizeStoreModel),
          name: item.name,
        }))
        .filter((item) => item.models.length > 0);

      if (mappedStoreProviders.length > 0) {
        const providers = toLimitedProviders(mappedStoreProviders, limit);
        return {
          providers,
          totalModels: providers.reduce((sum, item) => sum + item.models.length, 0),
        };
      }

      const runtimeState = await aiProviderService.getAiProviderRuntimeState();
      const enabledProviders = provider
        ? runtimeState.enabledVideoAiProviders.filter((item) => item.id === provider)
        : runtimeState.enabledVideoAiProviders;
      const providers = await Promise.all(
        enabledProviders.map(async (item) => {
          const models = await aiModelService.getAiProviderModelList(item.id, {
            enabled: true,
            limit,
            type: 'video',
          });
          return {
            id: item.id,
            models: models.map(normalizeRawModel),
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
};

class VideoGenerationExecutor extends BaseExecutor<typeof VideoGenerationApiName> {
  readonly identifier = VideoGenerationManifest.identifier;
  protected readonly apiEnum = VideoGenerationApiName;

  private runtime = createClientVideoGenerationRuntime();

  private toResult(output: BuiltinServerRuntimeOutput): BuiltinToolResult {
    const errorMessage =
      typeof output.error?.message === 'string' ? output.error.message : undefined;
    const content = output.content || errorMessage || 'Tool execution failed';

    if (!output.success) {
      return {
        content,
        error: output.error
          ? { body: output.error, message: errorMessage ?? content, type: 'PluginServerError' }
          : undefined,
        state: output.state,
        success: false,
      };
    }

    return { content, state: output.state, success: true };
  }

  listVideoModels = async (params: ListVideoModelsParams): Promise<BuiltinToolResult> =>
    this.toResult(await this.runtime.listVideoModels(params));

  getVideoModelParameters = async (
    params: GetVideoModelParametersParams,
  ): Promise<BuiltinToolResult> =>
    this.toResult(await this.runtime.getVideoModelParameters(params));

  generateVideo = async (
    params: GenerateVideoParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const topicVisibility = ctx?.agentId
      ? agentByIdSelectors.getAgentById(ctx.agentId)(getAgentStoreState())?.visibility
      : undefined;
    const runtime = createClientVideoGenerationRuntime(topicVisibility);

    return this.toResult(await runtime.generateVideo(params, { signal: ctx?.signal }));
  };

  getVideoGenerationStatus = async (
    params: GetVideoGenerationStatusParams,
  ): Promise<BuiltinToolResult> =>
    this.toResult(await this.runtime.getVideoGenerationStatus(params));
}

export const videoGenerationExecutor = new VideoGenerationExecutor();
