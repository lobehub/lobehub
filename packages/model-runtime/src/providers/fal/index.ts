import { fal } from '@fal-ai/client';
import debug from 'debug';
import { pick } from 'es-toolkit/compat';
import type { RuntimeImageGenParamsValue } from 'model-bank';
import type { ClientOptions } from 'openai';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import { AgentRuntimeErrorType } from '../../types/error';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { resolveMappedModelId } from '../../utils/modelIdMapping';

// Create debug logger
const log = debug('lobe-image:fal');

type FluxDevOutput = Awaited<ReturnType<typeof fal.subscribe<'fal-ai/flux/dev'>>>['data'];

/**
 * fal hosts models under several namespaces (e.g. `alibaba/qwen-image-3`); only bare
 * model ids without a known namespace get the default `fal-ai/` prefix.
 */
const FAL_NAMESPACES = ['fal-ai/', 'alibaba/'];

/**
 * Model families exposed as one card but served by separate fal endpoints: requests
 * with reference images go to `/edit`, others to `/text-to-image`.
 */
const EDIT_OR_TEXT_TO_IMAGE_ENDPOINT_PREFIXES = [
  'fal-ai/bytedance/seedream/v',
  'fal-ai/hunyuan-image/v',
  'alibaba/qwen-image-3',
];

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

export class LobeFalAI implements LobeRuntimeAI {
  private readonly modelIdMappingOptions: ModelIdMappingOptions;

  // OpenAI SDK v6 widened `apiKey` to `string | ApiKeySetter`; lobehub only uses the string form.
  constructor({
    apiKey,
    modelIdMapping,
  }: Omit<ClientOptions, 'apiKey'> & { apiKey?: string } & ModelIdMappingOptions = {}) {
    if (!apiKey) throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    fal.config({
      credentials: apiKey,
    });
    this.modelIdMappingOptions = { modelIdMapping };
    log('FalAI initialized with apiKey: %s', apiKey ? '*****' : 'Not set');
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

    if (typeof userInput.resolution === 'string' && RESOLUTION_BASE_EDGE[userInput.resolution]) {
      const imageSize = resolveFalImageSize(
        userInput.aspectRatio as string | undefined,
        userInput.resolution,
      );
      if (imageSize) userInput.image_size = imageSize;
      delete userInput.aspectRatio;
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

    const modelsAcceleratedByDefault = new Set<string>(['flux/krea']);
    if (modelsAcceleratedByDefault.has(requestModel)) {
      defaultInput['acceleration'] = 'high';
    }

    let endpoint = FAL_NAMESPACES.some((namespace) => requestModel.startsWith(namespace))
      ? requestModel
      : `fal-ai/${requestModel}`;
    const hasImageUrls = (params.imageUrls?.length ?? 0) > 0;
    if (EDIT_OR_TEXT_TO_IMAGE_ENDPOINT_PREFIXES.some((m) => endpoint.startsWith(m))) {
      endpoint += hasImageUrls ? '/edit' : '/text-to-image';
    } else if (endpoint === 'fal-ai/nano-banana' && hasImageUrls) {
      endpoint += '/edit';
    }

    const finalInput = {
      ...defaultInput,
      ...userInput,
    };

    log('Calling fal.subscribe with endpoint: %s and input: %O', endpoint, finalInput);
    try {
      const { data } = await fal.subscribe(endpoint, {
        input: finalInput,
      });
      const image = (data as FluxDevOutput).images[0];

      return {
        imageUrl: image.url,
        ...pick(image, ['width', 'height']),
      };
    } catch (error) {
      // https://docs.fal.ai/model-apis/errors/
      if (error instanceof Error && 'status' in error && error.status === 401) {
        throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey, {
          error,
        });
      }

      // 422 ValidationError with content_policy_violation — show a clean message
      if (error instanceof Error && 'status' in error && error.status === 422) {
        const body = 'body' in error ? (error as any).body : undefined;
        const hasContentPolicyViolation =
          Array.isArray(body?.detail) &&
          body.detail.some((d: any) => d.type === 'content_policy_violation');

        if (hasContentPolicyViolation) {
          throw AgentRuntimeError.createError(AgentRuntimeErrorType.ProviderBizError, {
            error,
            message:
              'The request content violates content policy. Please modify your prompt and try again.',
          });
        }
      }

      throw AgentRuntimeError.createError(AgentRuntimeErrorType.ProviderBizError, { error });
    }
  }
}
