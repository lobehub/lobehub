import type { BuiltinServerRuntimeOutput, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import type { AiProviderModelListItem } from 'model-bank';

import { aiModelService } from '@/services/aiModel';
import { aiProviderService } from '@/services/aiProvider';
import { generationService } from '@/services/generation';
import { generationTopicService } from '@/services/generationTopic';
import { imageService } from '@/services/image';
import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import type { ProviderModelListItem } from '@/store/aiInfra/slices/aiProvider/action';

import { ImageGenerationExecutionRuntime } from '../../ExecutionRuntime';
import { ImageGenerationManifest } from '../../manifest';
import type {
  GenerateImageParams,
  GetImageGenerationStatusParams,
  GetImageModelParametersParams,
  ImageGenerationModelSummary,
  ImageGenerationProviderModels,
  ListImageModelsParams,
} from '../../types';
import { ImageGenerationApiName } from '../../types';

const normalizeStoreModel = (model: ProviderModelListItem): ImageGenerationModelSummary => ({
  approximatePricePerImage: model.approximatePricePerImage,
  description: model.description,
  displayName: model.displayName,
  id: model.id,
  parameters: model.parameters,
  pricePerImage: model.pricePerImage,
  pricing: model.pricing,
  releasedAt: model.releasedAt,
});

const normalizeRawModel = (model: AiProviderModelListItem): ImageGenerationModelSummary => ({
  displayName: model.displayName,
  id: model.id,
  parameters: model.parameters,
  pricing: model.pricing,
  releasedAt: model.releasedAt,
});

const toLimitedProviders = (
  providers: ImageGenerationProviderModels[],
  limit: number,
): ImageGenerationProviderModels[] =>
  providers.map((provider) => ({ ...provider, models: provider.models.slice(0, limit) }));

const createClientImageGenerationRuntime = () => {
  return new ImageGenerationExecutionRuntime({
    createGenerationTopic: (type) => generationTopicService.createTopic(type),
    createImage: (payload) => imageService.createImage(payload),
    getGenerationStatus: async ({ asyncTaskId, generationId }) => {
      const result = await generationService.getGenerationStatus(generationId, asyncTaskId);
      return {
        ...result,
        asyncTaskId,
        generationId,
      };
    },
    listImageModels: async ({ provider, limit }) => {
      const storeProviders = aiProviderSelectors.enabledImageModelList(getAiInfraStoreState());
      const filteredStoreProviders = provider
        ? storeProviders.filter((item) => item.id === provider)
        : storeProviders;

      const mappedStoreProviders: ImageGenerationProviderModels[] = filteredStoreProviders
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
        ? runtimeState.enabledImageAiProviders.filter((item) => item.id === provider)
        : runtimeState.enabledImageAiProviders;

      const providers = await Promise.all(
        enabledProviders.map(async (item) => {
          const models = await aiModelService.getAiProviderModelList(item.id, {
            enabled: true,
            limit,
            type: 'image',
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

class ImageGenerationExecutor extends BaseExecutor<typeof ImageGenerationApiName> {
  readonly identifier = ImageGenerationManifest.identifier;
  protected readonly apiEnum = ImageGenerationApiName;

  private runtime = createClientImageGenerationRuntime();

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

  listImageModels = async (params: ListImageModelsParams): Promise<BuiltinToolResult> =>
    this.toResult(await this.runtime.listImageModels(params));

  getImageModelParameters = async (
    params: GetImageModelParametersParams,
  ): Promise<BuiltinToolResult> =>
    this.toResult(await this.runtime.getImageModelParameters(params));

  generateImage = async (params: GenerateImageParams): Promise<BuiltinToolResult> =>
    this.toResult(await this.runtime.generateImage(params));

  getImageGenerationStatus = async (
    params: GetImageGenerationStatusParams,
  ): Promise<BuiltinToolResult> =>
    this.toResult(await this.runtime.getImageGenerationStatus(params));
}

export const imageGenerationExecutor = new ImageGenerationExecutor();
