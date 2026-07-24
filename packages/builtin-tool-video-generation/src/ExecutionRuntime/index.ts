import {
  type AsyncTaskError,
  AsyncTaskStatus,
  type BuiltinServerRuntimeOutput,
} from '@lobechat/types';
import type { RuntimeVideoGenParams } from 'model-bank';
import { extractVideoDefaultValues } from 'model-bank';

import type {
  GeneratedVideoTask,
  GenerateVideoParams,
  GenerateVideoState,
  GetVideoGenerationStatusParams,
  GetVideoGenerationStatusState,
  GetVideoModelParametersParams,
  GetVideoModelParametersState,
  ListVideoModelsParams,
  ListVideoModelsState,
  VideoGenerationCreateVideoPayload,
  VideoGenerationCreateVideoResult,
} from '../types';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const MAX_PARAMETER_LOOKUP_LIMIT = 200;
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const MAX_WAIT_TIMEOUT_MS = 175_000;
const MIN_WAIT_TIMEOUT_MS = 1000;
const WAIT_TIMEOUT_BUFFER_MS = 5000;
const WAIT_POLL_INTERVAL_MS = 3000;
const MAX_GENERATION_TOPIC_TITLE_LENGTH = 100;

export interface GenerateVideoRuntimeContext {
  executionTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface VideoGenerationRuntimeService {
  createGenerationTopic: (type: 'video', title: string) => Promise<string>;
  createVideo: (
    payload: VideoGenerationCreateVideoPayload,
  ) => Promise<VideoGenerationCreateVideoResult>;
  getGenerationStatus: (
    params: GetVideoGenerationStatusParams,
  ) => Promise<GetVideoGenerationStatusState>;
  listVideoModels: (
    params: Required<Pick<ListVideoModelsParams, 'limit'>> &
      Pick<ListVideoModelsParams, 'provider'>,
  ) => Promise<ListVideoModelsState>;
}

const clampInteger = (value: number | undefined, fallback: number, max: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value as number)));
};

const formatErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;

const formatGenerationTopicTitle = (prompt: string) =>
  prompt.replaceAll(/\s+/g, ' ').trim().slice(0, MAX_GENERATION_TOPIC_TITLE_LENGTH);

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

const formatModelList = (state: ListVideoModelsState) => {
  if (state.totalModels === 0) {
    return 'No available video generation models were found.';
  }

  const lines = [`Available video generation models (${state.totalModels}):`];

  for (const provider of state.providers) {
    if (provider.models.length === 0) continue;

    lines.push(`\n${provider.name || provider.id} (${provider.id})`);
    for (const model of provider.models) {
      const displayName =
        model.displayName && model.displayName !== model.id ? ` — ${model.displayName}` : '';
      const description = model.description?.replaceAll(/\s+/g, ' ').trim() || 'Not provided.';
      const parameterKeys = model.parameters ? Object.keys(model.parameters) : [];
      const parameterHint =
        parameterKeys.length > 0 ? `; parameters: ${parameterKeys.join(', ')}` : '';
      lines.push(`- ${model.id}${displayName}${parameterHint}`);
      lines.push(`  Description: ${description}`);
    }
  }

  lines.push(
    '\nCall getVideoModelParameters with provider and model before passing model-specific parameters.',
  );

  return lines.join('\n');
};

const formatParameterDetails = (state: GetVideoModelParametersState) => {
  if (!state.parameters) {
    return `No parameter schema is available for ${state.provider}/${state.model}. Use prompt only unless the provider documentation says otherwise.`;
  }

  return [
    `Complete parameter schema for ${state.provider}/${state.model}:`,
    JSON.stringify(state.parameters, null, 2),
  ].join('\n');
};

const asyncTaskErrorMessage = (error: AsyncTaskError | null | undefined) => {
  if (!error) return 'Video generation failed.';
  const body = error.body;
  if (typeof body === 'string') return body;
  return body.detail || error.name || 'Video generation failed.';
};

const getAssetUrl = (state: GetVideoGenerationStatusState) => {
  const asset = state.generation?.asset;
  return asset?.url || asset?.originalUrl;
};

const getTaskAssetUrl = (task: GeneratedVideoTask) => task.asset?.url || task.asset?.originalUrl;

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
      reject(new Error('Video generation wait was aborted.'));
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timeout);
      reject(new Error('Video generation wait was aborted.'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });

const formatStatusContent = (state: GetVideoGenerationStatusState) => {
  if (state.status === AsyncTaskStatus.Success) {
    const url = getAssetUrl(state);
    return url
      ? `Video generation ${state.generationId} succeeded.\nVideo URL: ${url}\nMarkdown video link: [Generated video](${url})`
      : `Video generation ${state.generationId} succeeded.`;
  }

  if (state.status === AsyncTaskStatus.Error) {
    return `Video generation ${state.generationId} failed: ${asyncTaskErrorMessage(state.error)}`;
  }

  return `Video generation ${state.generationId} is ${state.status}. Check again later with getVideoGenerationStatus.`;
};

const formatTaskLine = (task: GeneratedVideoTask) => {
  const url = getTaskAssetUrl(task);
  const status = task.status ? `, status=${task.status}` : '';
  const error =
    task.status === AsyncTaskStatus.Error ? `, error=${asyncTaskErrorMessage(task.error)}` : '';
  const suffix = url ? `, videoUrl=${url}` : `, asyncTaskId=${task.asyncTaskId}${error}`;

  return `generationId=${task.generationId}${status}${suffix}`;
};

const formatStartedContent = (state: GenerateVideoState) =>
  [
    `Video generation started with ${state.provider}/${state.model}.`,
    state.batchId ? `Batch ID: ${state.batchId}` : undefined,
    formatTaskLine(state.generation),
    'Use getVideoGenerationStatus until status is success or error.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

const formatCompletedContent = (state: GenerateVideoState) => {
  const url = getTaskAssetUrl(state.generation);

  return [
    `Video generation completed with ${state.provider}/${state.model}.`,
    state.batchId ? `Batch ID: ${state.batchId}` : undefined,
    formatTaskLine(state.generation),
    url
      ? 'Markdown video link for the final response. Copy it exactly; do not rewrite the URL:'
      : undefined,
    url ? `[Generated video](${url})` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
};

const formatFailedContent = (state: GenerateVideoState) =>
  [
    `Video generation failed using ${state.provider}/${state.model}.`,
    state.batchId ? `Batch ID: ${state.batchId}` : undefined,
    formatTaskLine(state.generation),
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

const formatTimedOutContent = (state: GenerateVideoState, waitTimeoutMs: number) =>
  [
    `Video generation started with ${state.provider}/${state.model} and is still processing after ${waitTimeoutMs}ms.`,
    state.batchId ? `Batch ID: ${state.batchId}` : undefined,
    formatTaskLine(state.generation),
    'Use getVideoGenerationStatus later until status is success or error.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

const formatWaitFailedContent = (state: GenerateVideoState, message: string) =>
  [
    `Video generation started with ${state.provider}/${state.model}, but the latest status could not be checked.`,
    state.batchId ? `Batch ID: ${state.batchId}` : undefined,
    formatTaskLine(state.generation),
    `Status check error: ${message}`,
    'Use getVideoGenerationStatus later until status is success or error.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

const normalizeReferenceUrls = ({
  endImageUrl,
  imageUrl,
  imageUrls,
  parameters,
}: GenerateVideoParams): {
  endImageUrl?: null | string;
  imageUrl?: null | string;
  imageUrls?: string[];
} => {
  const normalized: {
    endImageUrl?: null | string;
    imageUrl?: null | string;
    imageUrls?: string[];
  } = {};

  const firstFrame = imageUrl === undefined ? parameters?.imageUrl : imageUrl;
  if (firstFrame === null || (typeof firstFrame === 'string' && firstFrame.trim())) {
    normalized.imageUrl = typeof firstFrame === 'string' ? firstFrame.trim() : firstFrame;
  }

  const finalFrame = endImageUrl === undefined ? parameters?.endImageUrl : endImageUrl;
  if (finalFrame === null || (typeof finalFrame === 'string' && finalFrame.trim())) {
    normalized.endImageUrl = typeof finalFrame === 'string' ? finalFrame.trim() : finalFrame;
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

export class VideoGenerationExecutionRuntime {
  private service: VideoGenerationRuntimeService;

  constructor(service: VideoGenerationRuntimeService) {
    this.service = service;
  }

  async listVideoModels(args: ListVideoModelsParams = {}): Promise<BuiltinServerRuntimeOutput> {
    try {
      const provider = args.provider?.trim() || undefined;
      const limit = clampInteger(args.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      const state = await this.service.listVideoModels({ limit, provider });

      return {
        content: formatModelList(state),
        state,
        success: true,
      };
    } catch (error) {
      const message = formatErrorMessage(error, 'Failed to list video models');
      return errorOutput('ListVideoModelsFailed', message);
    }
  }

  async getVideoModelParameters(
    args: GetVideoModelParametersParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    const provider = args.provider?.trim();
    const model = args.model?.trim();

    if (!provider || !model) {
      return errorOutput('InvalidToolArguments', '`provider` and `model` are required.');
    }

    try {
      const list = await this.service.listVideoModels({
        limit: MAX_PARAMETER_LOOKUP_LIMIT,
        provider,
      });
      const modelItem = list.providers
        .flatMap((item) => item.models)
        .find((item) => item.id === model);

      if (!modelItem) {
        return errorOutput('VideoModelNotFound', `Video model not found: ${provider}/${model}`);
      }

      const state: GetVideoModelParametersState = {
        displayName: modelItem.displayName,
        model,
        parameters: modelItem.parameters,
        provider,
        ...(modelItem.parameters && {
          defaultValues: extractVideoDefaultValues(modelItem.parameters),
        }),
      };

      return {
        content: formatParameterDetails(state),
        state,
        success: true,
      };
    } catch (error) {
      const message = formatErrorMessage(error, 'Failed to get video model parameters');
      return errorOutput('GetVideoModelParametersFailed', message);
    }
  }

  private async resolveVideoModel(
    provider?: string,
    model?: string,
  ): Promise<{ model: string; provider: string }> {
    const state = await this.service.listVideoModels({
      limit: MAX_PARAMETER_LOOKUP_LIMIT,
      provider,
    });

    if (model) {
      const matchedProvider = state.providers.find(
        (item) =>
          (!provider || item.id === provider) &&
          item.models.some((candidate) => candidate.id === model),
      );

      if (matchedProvider) return { model, provider: matchedProvider.id };
    } else {
      for (const providerItem of state.providers) {
        const firstModel = providerItem.models[0];
        if (firstModel) return { model: firstModel.id, provider: providerItem.id };
      }
    }

    const requestedSelection = [provider, model].filter(Boolean).join('/');
    throw new Error(
      requestedSelection
        ? `No enabled video generation model matched ${requestedSelection}.`
        : 'No enabled video generation model is available.',
    );
  }

  private async waitForGeneration(
    generation: GeneratedVideoTask,
    waitTimeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ generation: GeneratedVideoTask; timedOut: boolean }> {
    const deadline = Date.now() + waitTimeoutMs;
    let current = generation;

    while (true) {
      const status = await this.service.getGenerationStatus({
        asyncTaskId: current.asyncTaskId,
        generationId: current.generationId,
      });
      current = {
        ...current,
        asset: status.generation?.asset ?? current.asset,
        error: status.error,
        status: status.status,
      };

      if (isTerminalStatus(status.status)) {
        return { generation: current, timedOut: false };
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return { generation: current, timedOut: true };
      }

      await sleep(Math.min(WAIT_POLL_INTERVAL_MS, remainingMs), signal);
    }
  }

  async generateVideo(
    args: GenerateVideoParams,
    context: GenerateVideoRuntimeContext = {},
  ): Promise<BuiltinServerRuntimeOutput> {
    const prompt = args.prompt?.trim();
    if (!prompt) {
      return errorOutput('InvalidToolArguments', '`prompt` is required.');
    }

    const referenceUrls = normalizeReferenceUrls(args);
    if (referenceUrls.endImageUrl && !referenceUrls.imageUrl) {
      return errorOutput(
        'InvalidToolArguments',
        '`endImageUrl` requires `imageUrl` to provide the first frame.',
      );
    }

    let selection: { model: string; provider: string };
    try {
      selection = await this.resolveVideoModel(args.provider?.trim(), args.model?.trim());
    } catch (error) {
      const message = formatErrorMessage(error, 'Failed to resolve a video generation model');
      return errorOutput('VideoModelNotFound', message);
    }

    const { model, provider } = selection;
    const waitUntilComplete = args.waitUntilComplete !== false;
    const params = {
      ...args.parameters,
      ...referenceUrls,
      prompt,
    } as RuntimeVideoGenParams & Record<string, unknown>;

    try {
      const generationTopicId = await this.service.createGenerationTopic(
        'video',
        formatGenerationTopicTitle(prompt),
      );
      const result = await this.service.createVideo({
        generationTopicId,
        model,
        params,
        provider,
      });
      const item = result.data?.generations?.[0];

      if (!result.success || !item?.id || !item.asyncTaskId) {
        return errorOutput(
          'GenerateVideoFailed',
          'Video generation did not return generation and async task ids.',
          {
            generationTopicId,
            model,
            provider,
          },
        );
      }

      const state: GenerateVideoState = {
        batchId: result.data?.batch?.id,
        generation: {
          asyncTaskId: item.asyncTaskId,
          generationId: item.id,
        },
        generationTopicId,
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
      let waitResult: { generation: GeneratedVideoTask; timedOut: boolean };
      try {
        waitResult = await this.waitForGeneration(state.generation, waitTimeoutMs, context.signal);
      } catch (error) {
        if (context.signal?.aborted) throw error;

        const message = formatErrorMessage(error, 'Failed to wait for video generation status');
        const waitFailedState: GenerateVideoState = {
          ...state,
          waitError: message,
        };

        return {
          content: formatWaitFailedContent(waitFailedState, message),
          state: waitFailedState,
          success: true,
        };
      }

      const waitedState: GenerateVideoState = {
        ...state,
        generation: waitResult.generation,
        waitTimedOut: waitResult.timedOut,
      };

      if (waitResult.timedOut) {
        return {
          content: formatTimedOutContent(waitedState, waitTimeoutMs),
          state: waitedState,
          success: true,
        };
      }

      if (waitedState.generation.status === AsyncTaskStatus.Error) {
        return errorOutput('GenerateVideoFailed', formatFailedContent(waitedState), {
          ...waitedState,
        });
      }

      return {
        content: formatCompletedContent(waitedState),
        state: waitedState,
        success: true,
      };
    } catch (error) {
      const message = formatErrorMessage(error, 'Failed to generate video');
      return errorOutput('GenerateVideoFailed', message);
    }
  }

  async getVideoGenerationStatus(
    args: GetVideoGenerationStatusParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    const generationId = args.generationId?.trim();
    const asyncTaskId = args.asyncTaskId?.trim();

    if (!generationId || !asyncTaskId) {
      return errorOutput('InvalidToolArguments', '`generationId` and `asyncTaskId` are required.');
    }

    try {
      const state = await this.service.getGenerationStatus({ asyncTaskId, generationId });
      const success = state.status !== AsyncTaskStatus.Error;

      return {
        content: formatStatusContent(state),
        ...(success
          ? {}
          : {
              error: {
                message: asyncTaskErrorMessage(state.error),
                type: 'VideoGenerationFailed',
              },
            }),
        state,
        success,
      };
    } catch (error) {
      const message = formatErrorMessage(error, 'Failed to get video generation status');
      return errorOutput('GetVideoGenerationStatusFailed', message, {
        asyncTaskId,
        generationId,
      });
    }
  }
}
