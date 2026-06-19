import { BRANDING_PROVIDER } from '@lobechat/business-const';
import {
  type AsyncTaskError,
  AsyncTaskStatus,
  type BuiltinServerRuntimeOutput,
} from '@lobechat/types';
import type { RuntimeImageGenParams } from 'model-bank';
import { extractDefaultValues } from 'model-bank';

import type {
  GeneratedImageTask,
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
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const MAX_WAIT_TIMEOUT_MS = 175_000;
const MIN_WAIT_TIMEOUT_MS = 1000;
const WAIT_TIMEOUT_BUFFER_MS = 5000;
const WAIT_POLL_INTERVAL_MS = 3000;

export interface GenerateImageRuntimeContext {
  executionTimeoutMs?: number;
  signal?: AbortSignal;
}

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

const getTaskAssetUrl = (task: GeneratedImageTask) =>
  task.asset?.url || task.asset?.thumbnailUrl || task.asset?.originalUrl;

const isTerminalStatus = (status: AsyncTaskStatus) =>
  status === AsyncTaskStatus.Success || status === AsyncTaskStatus.Error;

const resolveWaitTimeoutMs = (waitTimeoutMs: number | undefined, executionTimeoutMs?: number) => {
  const requested =
    typeof waitTimeoutMs === 'number' && Number.isFinite(waitTimeoutMs) && waitTimeoutMs > 0
      ? Math.trunc(waitTimeoutMs)
      : DEFAULT_WAIT_TIMEOUT_MS;
  const runtimeBudget =
    typeof executionTimeoutMs === 'number' && Number.isFinite(executionTimeoutMs)
      ? Math.max(MIN_WAIT_TIMEOUT_MS, Math.trunc(executionTimeoutMs) - WAIT_TIMEOUT_BUFFER_MS)
      : MAX_WAIT_TIMEOUT_MS;

  return Math.min(
    Math.max(requested, MIN_WAIT_TIMEOUT_MS),
    Math.min(runtimeBudget, MAX_WAIT_TIMEOUT_MS),
  );
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }

    if (signal?.aborted) {
      reject(new Error('Image generation wait was aborted.'));
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timeout);
      reject(new Error('Image generation wait was aborted.'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });

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

const formatGenerationLines = (generations: GeneratedImageTask[]) =>
  generations.map((item, index) => {
    const url = getTaskAssetUrl(item);
    const status = item.status ? `, status=${item.status}` : '';
    const error =
      item.status === AsyncTaskStatus.Error ? `, error=${asyncTaskErrorMessage(item.error)}` : '';
    const suffix = url ? `, imageUrl=${url}` : `, asyncTaskId=${item.asyncTaskId}${error}`;

    return `${index + 1}. generationId=${item.generationId}${status}${suffix}`;
  });

const formatMarkdownImageLines = (generations: GeneratedImageTask[]) =>
  generations
    .map((item, index) => {
      const url = getTaskAssetUrl(item);
      return url ? `![Generated image ${index + 1}](${url})` : undefined;
    })
    .filter((line): line is string => Boolean(line));

const formatStartedContent = (state: GenerateImageState) =>
  [
    `Image generation started with ${state.provider}/${state.model}.`,
    state.batchId ? `Batch ID: ${state.batchId}` : undefined,
    'Generations:',
    ...formatGenerationLines(state.generations),
    'Use getImageGenerationStatus for each generation until status is success or error.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

const formatCompletedContent = (state: GenerateImageState) =>
  [
    `Image generation completed with ${state.provider}/${state.model}.`,
    state.batchId ? `Batch ID: ${state.batchId}` : undefined,
    'Images:',
    ...formatGenerationLines(state.generations),
    ...formatMarkdownImageLines(state.generations),
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

const formatTimedOutContent = (state: GenerateImageState, waitTimeoutMs: number) =>
  [
    `Image generation started with ${state.provider}/${state.model} and is still processing after ${waitTimeoutMs}ms.`,
    state.batchId ? `Batch ID: ${state.batchId}` : undefined,
    'Current generations:',
    ...formatGenerationLines(state.generations),
    'Use getImageGenerationStatus later only for generations that are not success or error.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

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

  private async waitForGenerations(
    generations: GeneratedImageTask[],
    waitTimeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ generations: GeneratedImageTask[]; timedOut: boolean }> {
    const deadline = Date.now() + waitTimeoutMs;
    let current = generations;

    while (true) {
      const statuses = await Promise.all(
        current.map((item) =>
          this.service.getGenerationStatus({
            asyncTaskId: item.asyncTaskId,
            generationId: item.generationId,
          }),
        ),
      );

      current = current.map((item, index) => {
        const state = statuses[index]!;

        return {
          ...item,
          asset: state.generation?.asset ?? item.asset,
          error: state.error,
          status: state.status,
        };
      });

      if (statuses.every((item) => isTerminalStatus(item.status))) {
        return { generations: current, timedOut: false };
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return { generations: current, timedOut: true };
      }

      await sleep(Math.min(WAIT_POLL_INTERVAL_MS, remainingMs), signal);
    }
  }

  async generateImage(
    args: GenerateImageParams,
    context: GenerateImageRuntimeContext = {},
  ): Promise<BuiltinServerRuntimeOutput> {
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
    const waitUntilComplete = args.waitUntilComplete !== false;
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

      if (result.data.generations.some((item) => !item.id || !item.asyncTaskId)) {
        return errorOutput(
          'GenerateImageFailed',
          'Image generation did not return generation or async task ids.',
          {
            generationTopicId,
            model,
            provider,
          },
        );
      }

      const generations = result.data.generations.map((item) => ({
        asyncTaskId: item.asyncTaskId ?? '',
        generationId: item.id ?? '',
      }));

      const state: GenerateImageState = {
        batchId: result.data.batch?.id,
        generationTopicId,
        generations,
        imageNum,
        model,
        prompt,
        provider,
        waitUntilComplete,
      };

      if (!waitUntilComplete) {
        return {
          content: formatStartedContent(state),
          state,
          success: true,
        };
      }

      const waitTimeoutMs = resolveWaitTimeoutMs(args.waitTimeoutMs, context.executionTimeoutMs);
      const waitResult = await this.waitForGenerations(generations, waitTimeoutMs, context.signal);
      const waitedState: GenerateImageState = {
        ...state,
        generations: waitResult.generations,
        waitTimedOut: waitResult.timedOut,
      };

      if (waitResult.timedOut) {
        return {
          content: formatTimedOutContent(waitedState, waitTimeoutMs),
          state: waitedState,
          success: true,
        };
      }

      if (waitResult.generations.some((item) => item.status === AsyncTaskStatus.Error)) {
        const message = 'One or more image generations failed.';
        return {
          content: formatCompletedContent(waitedState),
          error: { message, type: 'ImageGenerationFailed' },
          state: waitedState,
          success: false,
        };
      }

      return {
        content: formatCompletedContent(waitedState),
        state: waitedState,
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
