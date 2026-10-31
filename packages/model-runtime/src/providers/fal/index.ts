import { createFalClient, fal, type FalClient } from '@fal-ai/client';
import type { ChatModelCard } from '@lobechat/types';
import debug from 'debug';
import { pick } from 'es-toolkit/compat';
import type { RuntimeImageGenParamsValue } from 'model-bank';
import type { ClientOptions } from 'openai';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import { AgentRuntimeErrorType } from '../../types/error';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import type {
  CreateVideoPayload,
  CreateVideoResult,
  PollVideoStatusResult,
  VideoGenerationCapabilities,
} from '../../types/video';
import { AgentRuntimeError } from '../../utils/createError';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { resolveMappedModelId } from '../../utils/modelIdMapping';
import { getFalInputSchema, listFalGenerationModels } from './catalog';
import { createFalVideo, getFalTaskRoutedVideoEndpoints, pollFalVideoStatus } from './createVideo';
import {
  isFalResolutionTierEndpoint,
  resolveFalEndpointId,
  resolveFalImageEndpoint,
} from './endpoint';
import { coerceFalInput } from './schema';

// Create debug logger
const log = debug('lobe-image:fal');

interface FalImageOutput {
  image?: { height?: number; url: string; width?: number };
  images?: { height?: number; url: string; width?: number }[];
}

/** fal endpoints that run faster with `acceleration: 'high'` at no quality cost */
const ACCELERATED_BY_DEFAULT_ENDPOINTS = new Set(['fal-ai/flux/krea']);

/**
 * Long edge of a square image for each `resolution` preset. fal bills some models
 * (e.g. Qwen Image 3) by output resolution tier, so the requested pixel count must
 * stay within the tier the user picked.
 */
const RESOLUTION_BASE_EDGE: Record<string, number> = { '1K': 1024, '2K': 2048 };

/**
 * fal clamps each side to this length (a 2720x1536 request came back as 2048x1536),
 * so wide 2K sizes must be scaled down to keep the requested aspect ratio.
 */
const MAX_IMAGE_SIDE = 2048;

/**
 * Convert `aspectRatio` + `resolution` presets into a fal `image_size` whose pixel
 * count does not exceed the square of the preset edge and whose sides stay within
 * `MAX_IMAGE_SIDE`, with both sides multiples of 16.
 */
export const resolveFalImageSize = (
  aspectRatio: string | undefined,
  resolution: string,
): { height: number; width: number } | undefined => {
  const baseEdge = RESOLUTION_BASE_EDGE[resolution];
  if (!baseEdge) return;

  const [ratioWidth, ratioHeight] = (aspectRatio ?? '1:1').split(':').map(Number);
  if (!ratioWidth || !ratioHeight) return;

  const scale = Math.min(
    Math.sqrt((baseEdge * baseEdge) / (ratioWidth * ratioHeight)),
    MAX_IMAGE_SIDE / Math.max(ratioWidth, ratioHeight),
  );
  const roundDown = (value: number) => Math.floor(value / 16) * 16;

  return { height: roundDown(ratioHeight * scale), width: roundDown(ratioWidth * scale) };
};

/**
 * fal endpoints served by the built-in cards: each card's id plus the task endpoints its one-card
 * family routes to (e.g. `fal-ai/bytedance/seedream/v4/edit`). The catalog copies of these are
 * duplicates without the curated parameters and pricing.
 */
const loadBuiltinFalEndpoints = async () => {
  const { default: builtinModels } = await import('model-bank/fal');

  return new Set(
    builtinModels.flatMap(({ id }) => [
      id,
      resolveFalImageEndpoint(id, false),
      resolveFalImageEndpoint(id, true),
      ...getFalTaskRoutedVideoEndpoints(id),
    ]),
  );
};

// https://docs.fal.ai/model-apis/errors/
const toFalRuntimeError = (error: unknown) => {
  if (error instanceof Error && 'status' in error && error.status === 401) {
    return AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey, { error });
  }

  // 422 ValidationError with content_policy_violation — show a clean message
  if (error instanceof Error && 'status' in error && error.status === 422) {
    const body = 'body' in error ? (error as any).body : undefined;
    const hasContentPolicyViolation =
      Array.isArray(body?.detail) &&
      body.detail.some((d: any) => d.type === 'content_policy_violation');

    if (hasContentPolicyViolation) {
      return AgentRuntimeError.createError(AgentRuntimeErrorType.ProviderBizError, {
        error,
        message:
          'The request content violates content policy. Please modify your prompt and try again.',
      });
    }
  }

  return AgentRuntimeError.createError(AgentRuntimeErrorType.ProviderBizError, { error });
};

export class LobeFalAI implements LobeRuntimeAI {
  private readonly modelIdMappingOptions: ModelIdMappingOptions;
  /**
   * Video requests use a client scoped to this instance: the global `fal.config` is shared by
   * every instance, so concurrent router channels with different keys would overwrite it between
   * submitting a request and polling it.
   */
  private readonly client: FalClient;
  private readonly apiKey: string;

  // OpenAI SDK v6 widened `apiKey` to `string | ApiKeySetter`; lobehub only uses the string form.
  constructor({
    apiKey,
    modelIdMapping,
  }: Omit<ClientOptions, 'apiKey'> & { apiKey?: string } & ModelIdMappingOptions = {}) {
    if (!apiKey) throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    fal.config({
      credentials: apiKey,
    });
    this.apiKey = apiKey;
    this.client = createFalClient({ credentials: apiKey });
    this.modelIdMappingOptions = { modelIdMapping };
    log('FalAI initialized with apiKey: %s', apiKey ? '*****' : 'Not set');
  }

  getVideoGenerationCapabilities(): VideoGenerationCapabilities {
    return { completionModes: ['polling'] };
  }

  async createVideo(payload: CreateVideoPayload): Promise<CreateVideoResult> {
    const requestModel = resolveFalEndpointId(
      resolveMappedModelId(payload.model, this.modelIdMappingOptions),
    );

    try {
      return await createFalVideo(this.client, requestModel, payload.params, (endpoint) =>
        getFalInputSchema(this.apiKey, endpoint),
      );
    } catch (error) {
      throw toFalRuntimeError(error);
    }
  }

  async handlePollVideoStatus(inferenceId: string): Promise<PollVideoStatusResult> {
    return pollFalVideoStatus(this.client, inferenceId);
  }

  async createImage(payload: CreateImagePayload): Promise<CreateImageResponse> {
    const { model, params } = payload;
    const requestModel = resolveMappedModelId(model, this.modelIdMappingOptions);
    log('Creating image with model: %s and params: %O', requestModel, params);

    const paramsMap = new Map<RuntimeImageGenParamsValue, string>([
      ['steps', 'num_inference_steps'],
      ['cfg', 'guidance_scale'],
      ['imageUrl', 'image_url'],
      ['imageUrls', 'image_urls'],
      ['size', 'image_size'],
      ['aspectRatio', 'aspect_ratio'],
    ]);

    const defaultInput: Record<string, unknown> = {
      enable_safety_checker: false,
      num_images: 1,
    };
    const userInput: Record<string, unknown> = Object.fromEntries(
      (Object.entries(params) as [keyof typeof params, any][])
        .filter(([, value]) => {
          const isEmptyValue =
            value === null || value === undefined || (Array.isArray(value) && value.length === 0);
          return !isEmptyValue;
        })
        .map(([key, value]) => [paramsMap.get(key) ?? key, value]),
    );

    const hasImageUrls = (params.imageUrls?.length ?? 0) > 0;
    const endpoint = resolveFalImageEndpoint(requestModel, hasImageUrls);

    if (
      isFalResolutionTierEndpoint(endpoint) &&
      typeof userInput.resolution === 'string' &&
      RESOLUTION_BASE_EDGE[userInput.resolution]
    ) {
      const imageSize = resolveFalImageSize(
        userInput.aspect_ratio as string | undefined,
        userInput.resolution,
      );
      if (imageSize) userInput.image_size = imageSize;
      delete userInput.aspect_ratio;
      delete userInput.resolution;
    }

    if ('width' in userInput && 'height' in userInput) {
      if (userInput.size) {
        throw new Error('width/height and size are not supported at the same time');
      } else {
        userInput.image_size = {
          height: userInput.height,
          width: userInput.width,
        };
        delete userInput.width;
        delete userInput.height;
      }
    }

    if (ACCELERATED_BY_DEFAULT_ENDPOINTS.has(endpoint)) {
      defaultInput['acceleration'] = 'high';
    }

    const builtinEndpoints = await loadBuiltinFalEndpoints();
    const input = { ...defaultInput, ...userInput };
    // Fetched endpoints only accept the fields their schema declares; built-in cards send the
    // curated input as is
    const finalInput = builtinEndpoints.has(endpoint)
      ? input
      : coerceFalInput(input, await getFalInputSchema(this.apiKey, endpoint));

    log('Calling fal.subscribe with endpoint: %s and input: %O', endpoint, finalInput);
    try {
      const { data } = await fal.subscribe(endpoint, {
        input: finalInput,
      });
      const output = data as FalImageOutput;
      const image = output.images?.[0] ?? output.image;
      if (!image?.url) throw new Error(`fal returned no image for ${endpoint}`);

      return {
        imageUrl: image.url,
        ...pick(image, ['width', 'height']),
      };
    } catch (error) {
      throw toFalRuntimeError(error);
    }
  }

  /**
   * List fal's image and video endpoints with parameters derived from their input schemas, so any
   * endpoint (any owner, not only `fal-ai/`) can be enabled on the generation pages. Endpoints of
   * built-in cards are skipped: they are already listed with curated parameters and pricing.
   */
  async models(): Promise<ChatModelCard[]> {
    const builtinEndpoints = await loadBuiltinFalEndpoints();

    try {
      const models = await listFalGenerationModels(this.apiKey);

      return models
        .filter((model) => !builtinEndpoints.has(model.id))
        .map(({ parameters, ...model }) => ({
          ...model,
          enabled: false,
          parameters: parameters as ChatModelCard['parameters'],
        }));
    } catch (error) {
      throw toFalRuntimeError(error);
    }
  }
}
