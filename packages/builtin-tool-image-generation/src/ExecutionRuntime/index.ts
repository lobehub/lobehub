import { BRANDING_PROVIDER } from '@lobechat/business-const';
import type { AsyncTaskError, BuiltinServerRuntimeOutput } from '@lobechat/types';
import type { RuntimeImageGenParams } from 'model-bank';
import { extractDefaultValues } from 'model-bank';

import type {
  GenerateImageParams,
  GenerateImageState,
  GetImageGenerationStatusParams,
  GetImageGenerationStatusState,
  GetImageModelParametersParams,
  GetImageModelParametersState,
  ImageGenerationCreateImagePayload,
  ImageGenerationCreateImageResult,
  ListImageModelsParams,
  ListImageModelsState,
} from '../types';

export const DEFAULT_IMAGE_GENERATION_MODEL = 'gpt-image-2';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const MAX_PARAMETER_LOOKUP_LIMIT = 200;
const DEFAULT_IMAGE_NUM = 1;
const MAX_IMAGE_NUM = 8;

export interface ImageGenerationRuntimeService {
  createGenerationTopic: (type: 'image') => Promise<string>;
  createImage: (
    payload: ImageGenerationCreateImagePayload,
  ) => Promise<ImageGenerationCreateImageResult>;
  getGenerationStatus: (
    params: GetImageGenerationStatusParams,
  ) => Promise<GetImageGenerationStatusState>;
  listImageModels: (
    params: Required<Pick<ListImageModelsParams, 'limit'>> &
      Pick<ListImageModelsParams, 'provider'>,
  ) => Promise<ListImageModelsState>;
}

const clampInteger = (value: number | undefined, fallback: number, max: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value as number)));
};

const formatErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;

const errorOutput = (
  type: string,
  message: string,
  state?: Record<string, unknown>,
): BuiltinServerRuntimeOutput => ({
  content: message,
  error: { message, type },
  state,
  success: false,
});

const formatModelList = (state: ListImageModelsState) => {
  if (state.totalModels === 0) {
    return 'No available image generation models were found.';
  }

  const lines = [`Available image generation models (${state.totalModels}):`];

  for (const provider of state.providers) {
    if (provider.models.length === 0) continue;

    lines.push(`\n${provider.name || provider.id} (${provider.id})`);
    for (const model of provider.models) {
      const displayName =
        model.displayName && model.displayName !== model.id ? ` — ${model.displayName}` : '';
      const parameterKeys = model.parameters ? Object.keys(model.parameters) : [];
      const parameterHint =
        parameterKeys.length > 0 ? `; parameters: ${parameterKeys.join(', ')}` : '';
      lines.push(`- ${model.id}${displayName}${parameterHint}`);
    }
  }

  lines.push(
    '\nCall getImageModelParameters with provider and model before passing model-specific parameters.',
  );

  return lines.join('\n');
};

const formatParameterDetails = (state: GetImageModelParametersState) => {
  if (!state.parameters) {
    return `No parameter schema is available for ${state.provider}/${state.model}. Use prompt only unless the provider documentation says otherwise.`;
  }

  const parameterKeys = Object.keys(state.parameters);
  return [
    `Parameter schema for ${state.provider}/${state.model}: ${parameterKeys.join(', ')}`,
    `Default values: ${JSON.stringify(state.defaultValues ?? {})}`,
  ].join('\n');
};

const asyncTaskErrorMessage = (error: AsyncTaskError | null | undefined) => {
  if (!error) return 'Image generation failed.';
  const body = error.body;
  if (typeof body === 'string') return body;
  return body.detail || error.name || 'Image generation failed.';
};

const getAssetUrl = (state: GetImageGenerationStatusState) => {
  const asset = state.generation?.asset;
  return asset?.url || asset?.thumbnailUrl || asset?.originalUrl;
};

const formatStatusContent = (state: GetImageGenerationStatusState) => {
  if (state.status === 'success') {
    const url = getAssetUrl(state);
    return url
      ? `Image generation ${state.generationId} succeeded.\nImage URL: ${url}`
      : `Image generation ${state.generationId} succeeded.`;
  }

  if (state.status === 'error') {
    return `Image generation ${state.generationId} failed: ${asyncTaskErrorMessage(state.error)}`;
  }

  return `Image generation ${state.generationId} is ${state.status}. Check again later with getImageGenerationStatus.`;
};

const normalizeReferenceUrls = ({
  imageUrl,
  imageUrls,
  parameters,
}: GenerateImageParams): { imageUrl?: null | string; imageUrls?: string[] } => {
  const normalized: { imageUrl?: null | string; imageUrls?: string[] } = {};

  if (imageUrl === null || (typeof imageUrl === 'string' && imageUrl.trim())) {
    normalized.imageUrl = typeof imageUrl === 'string' ? imageUrl.trim() : imageUrl;
  } else if (typeof parameters?.imageUrl === 'string' && parameters.imageUrl.trim()) {
    normalized.imageUrl = parameters.imageUrl.trim();
  }

  const urlList =
    imageUrls && imageUrls.length > 0
      ? imageUrls
      : Array.isArray(parameters?.imageUrls)
        ? parameters.imageUrls
        : [];

  const normalizedUrls = urlList
    .filter((url): url is string => typeof url === 'string' && !!url.trim())
    .map((url) => url.trim());
  if (normalizedUrls.length > 0) normalized.imageUrls = normalizedUrls;

  return normalized;
};

export class ImageGenerationExecutionRuntime {
  private service: ImageGenerationRuntimeService;

  constructor(service: ImageGenerationRuntimeService) {
    this.service = service;
  }

  async listImageModels(args: ListImageModelsParams = {}): Promise<BuiltinServerRuntimeOutput> {
    try {
      const provider = args.provider?.trim() || undefined;
      const limit = clampInteger(args.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      const state = await this.service.listImageModels({ limit, provider });

      return {
        content: formatModelList(state),
        state,
        success: true,
      };
    } catch (error) {
      const message = formatErrorMessage(error, 'Failed to list image models');
      return errorOutput('ListImageModelsFailed', message);
    }
  }

  async getImageModelParameters(
    args: GetImageModelParametersParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    const provider = args.provider?.trim();
    const model = args.model?.trim();

    if (!provider || !model) {
      return errorOutput('InvalidToolArguments', '`provider` and `model` are required.');
    }

    try {
      const list = await this.service.listImageModels({
        limit: MAX_PARAMETER_LOOKUP_LIMIT,
        provider,
      });
      const modelItem = list.providers
        .flatMap((item) => item.models)
        .find((item) => item.id === model);

      if (!modelItem) {
        return errorOutput('ImageModelNotFound', `Image model not found: ${provider}/${model}`);
      }

      const state: GetImageModelParametersState = {
        displayName: modelItem.displayName,
        model,
        parameters: modelItem.parameters,
        provider,
        ...(modelItem.parameters && { defaultValues: extractDefaultValues(modelItem.parameters) }),
      };

      return {
        content: formatParameterDetails(state),
        state,
        success: true,
      };
    } catch (error) {
      const message = formatErrorMessage(error, 'Failed to get image model parameters');
      return errorOutput('GetImageModelParametersFailed', message);
    }
  }

  async generateImage(args: GenerateImageParams): Promise<BuiltinServerRuntimeOutput> {
    const prompt = args.prompt?.trim();
    if (!prompt) {
      return errorOutput('InvalidToolArguments', '`prompt` is required.');
    }

    const imageNum = clampInteger(args.imageNum, DEFAULT_IMAGE_NUM, MAX_IMAGE_NUM);
    if (typeof args.imageNum === 'number' && args.imageNum !== imageNum) {
      return errorOutput(
        'InvalidToolArguments',
        `imageNum must be an integer between 1 and ${MAX_IMAGE_NUM}.`,
      );
    }

    const provider = args.provider?.trim() || BRANDING_PROVIDER;
    const model = args.model?.trim() || DEFAULT_IMAGE_GENERATION_MODEL;
    const referenceUrls = normalizeReferenceUrls(args);
    const params = {
      ...args.parameters,
      ...referenceUrls,
      prompt,
    } as RuntimeImageGenParams & Record<string, unknown>;

    try {
      const generationTopicId = await this.service.createGenerationTopic('image');
      const result = await this.service.createImage({
        generationTopicId,
        imageNum,
        model,
        params,
        provider,
      });

      if (!result.success || !result.data?.generations?.length) {
        return errorOutput('GenerateImageFailed', 'Image generation did not return task ids.', {
          generationTopicId,
          model,
          provider,
        });
      }

      if (result.data.generations.some((item) => !item.asyncTaskId)) {
        return errorOutput(
          'GenerateImageFailed',
          'Image generation did not return async task ids.',
          {
            generationTopicId,
            model,
            provider,
          },
        );
      }

      const generations = result.data.generations.map((item) => ({
        asyncTaskId: item.asyncTaskId ?? '',
        generationId: item.id,
      }));

      const state: GenerateImageState = {
        batchId: result.data.batch?.id,
        generationTopicId,
        generations,
        imageNum,
        model,
        prompt,
        provider,
      };

      const lines = [
        `Image generation started with ${provider}/${model}.`,
        result.data.batch?.id ? `Batch ID: ${result.data.batch.id}` : undefined,
        'Generations:',
        ...generations.map(
          (item, index) =>
            `${index + 1}. generationId=${item.generationId}, asyncTaskId=${item.asyncTaskId}`,
        ),
        'Use getImageGenerationStatus for each generation until status is success or error.',
      ].filter((line): line is string => Boolean(line));

      return {
        content: lines.join('\n'),
        state,
        success: true,
      };
    } catch (error) {
      const message = formatErrorMessage(error, 'Failed to start image generation');
      return errorOutput('GenerateImageFailed', message, { model, provider });
    }
  }

  async getImageGenerationStatus(
    args: GetImageGenerationStatusParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    const generationId = args.generationId?.trim();
    const asyncTaskId = args.asyncTaskId?.trim();

    if (!generationId || !asyncTaskId) {
      return errorOutput('InvalidToolArguments', '`generationId` and `asyncTaskId` are required.');
    }

    try {
      const state = await this.service.getGenerationStatus({ asyncTaskId, generationId });
      const content = formatStatusContent(state);

      if (state.status === 'error') {
        return {
          content,
          error: { message: asyncTaskErrorMessage(state.error), type: 'ImageGenerationFailed' },
          state,
          success: false,
        };
      }

      return {
        content,
        state,
        success: true,
      };
    } catch (error) {
      const message = formatErrorMessage(error, 'Failed to get image generation status');
      return errorOutput('GetImageGenerationStatusFailed', message, { asyncTaskId, generationId });
    }
  }
}
