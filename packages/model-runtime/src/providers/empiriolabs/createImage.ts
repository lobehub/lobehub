import createDebug from 'debug';
import type { RuntimeImageGenParamsValue } from 'model-bank';

import type { CreateImageOptions } from '../../core/openaiCompatible';
import type { CreateImagePayload, CreateImageResponse } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';

const log = createDebug('lobe-image:empiriolabs');

/**
 * EmpirioLabs AI image response.
 * POST /v1/images/generations -> { created, data: [{ url }] }
 *
 * A generation that is still running when the request ends answers with a
 * `job_id` and no `data`.
 * @see https://docs.empiriolabs.ai/api-reference/api-reference/images/create-image
 */
interface EmpirioLabsImageResponse {
  data?: Array<{
    b64_json?: string;
    content_type?: string;
    url?: string;
  }>;
  job_id?: string;
}

/**
 * The API reads snake_case names, so the camelCase runtime parameters are
 * renamed here. A parameter that is not listed keeps its name.
 */
const paramsMap = new Map<RuntimeImageGenParamsValue, string>([
  ['aspectRatio', 'aspect_ratio'],
  ['cfg', 'guidance_scale'],
  ['promptExtend', 'prompt_extend'],
  ['steps', 'num_inference_steps'],
]);

/**
 * Create an image with the EmpirioLabs AI images API.
 *
 * The request body is JSON. Reference images are sent as URLs in `image`, so
 * image-to-image goes through the same endpoint as text-to-image.
 */
export async function createEmpirioLabsImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { model, params } = payload;
  const { apiKey, baseURL, provider } = options;

  log('Creating image with EmpirioLabs AI model: %s, params: %O', model, params);

  const body: Record<string, unknown> = { model, prompt: params.prompt };

  for (const [name, value] of Object.entries(params)) {
    const key = name as RuntimeImageGenParamsValue;
    if (key === 'prompt' || value === undefined || value === null) continue;

    if (key === 'imageUrl') {
      if (typeof value === 'string' && value !== '' && body.image === undefined) {
        body.image = [value];
      }
      continue;
    }

    if (key === 'imageUrls') {
      if (Array.isArray(value) && value.length > 0) body.image = value;
      continue;
    }

    body[paramsMap.get(key) ?? name] = value;
  }

  log('Request body: %O', body);

  const response = await fetch(`${baseURL || 'https://api.empiriolabs.ai/v1'}/images/generations`, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    log('Error response from EmpirioLabs AI: %O', { errorData, status: response.status });

    throw AgentRuntimeError.createImage({
      error: {
        ...errorData,
        status: response.status,
        statusText: response.statusText,
      },
      errorType:
        response.status === 401
          ? AgentRuntimeErrorType.InvalidProviderAPIKey
          : AgentRuntimeErrorType.ProviderBizError,
      provider,
    });
  }

  const data = (await response.json()) as EmpirioLabsImageResponse;
  const image = data.data?.[0];

  if (image?.url) return { imageUrl: image.url };

  if (image?.b64_json) {
    return { imageUrl: `data:${image.content_type || 'image/png'};base64,${image.b64_json}` };
  }

  log('No image in the EmpirioLabs AI response: %O', data);

  throw AgentRuntimeError.createImage({
    error: data.job_id
      ? { job_id: data.job_id, message: `The image is still being generated (job ${data.job_id})` }
      : { message: 'No images generated' },
    errorType: AgentRuntimeErrorType.ProviderBizError,
    provider,
  });
}
