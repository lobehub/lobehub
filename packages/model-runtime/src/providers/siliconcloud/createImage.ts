import { imageUrlToBase64 } from '@lobechat/utils';
import createDebug from 'debug';
import { RuntimeImageGenParamsValue } from 'model-bank';

import { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import { CreateImagePayload, CreateImageResponse } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { parseDataUri } from '../../utils/uriParser';

const log = createDebug('lobe-image:siliconcloud');

interface SiliconCloudImageResponse {
  images: { url: string }[];
  seed: number;
  timings: { inference: number };
}

async function convertToDataURI(imageUrl: string): Promise<string> {
  const { type, base64, mimeType } = parseDataUri(imageUrl);

  if (type === 'base64') {
    if (!base64) {
      throw new TypeError("Image URL doesn't contain base64 data");
    }
    return `data:${mimeType || 'image/png'};base64,${base64}`;
  }

  if (type === 'url') {
    const { base64: urlBase64, mimeType: urlMimeType } = await imageUrlToBase64(imageUrl);
    return `data:${urlMimeType};base64,${urlBase64}`;
  }

  throw new TypeError(`Unsupported image url: ${imageUrl}`);
}

export async function createSiliconCloudImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { model, params } = payload;
  const { apiKey, baseURL, provider } = options;

  log('Creating image with SiliconCloud model: %s, params: %O', model, params);

  const endpoint = `${baseURL}/images/generations`;

  const paramsMap = new Map<RuntimeImageGenParamsValue, string>([
    ['negativePrompt', 'negative_prompt'],
    ['size', 'image_size'],
    ['n', 'batch_size'],
    ['steps', 'num_inference_steps'],
  ]);

  const body: Record<string, any> = {
    model,
    prompt: params.prompt,
  };

  for (const [p, value] of Object.entries(params)) {
    const key = p as RuntimeImageGenParamsValue;
    if (value === undefined || value === null) continue;

    if (key === 'cfg') {
      if (model.toLowerCase().includes('kolors')) {
        body['guidance_scale'] = value;
      } else {
        body['cfg'] = value;
      }
      continue;
    }

    if (key === 'imageUrl') {
      if (typeof value === 'string') {
        body['image'] = await convertToDataURI(value);
      }
      continue;
    }

    if (key === 'imageUrls') {
      if (Array.isArray(value) && value.length > 0) {
        body['image'] = await convertToDataURI(value[0]);
        if (model === 'Qwen/Qwen-Image-Edit-2509') {
          if (value.length > 1) body['image2'] = await convertToDataURI(value[1]);
          if (value.length > 2) body['image3'] = await convertToDataURI(value[2]);
        }
      }
      continue;
    }

    const mappedKey = paramsMap.get(key) || p;
    body[mappedKey] = value;
  }

  log('Request body: %O', body);

  const response = await fetch(endpoint, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    log('Error response from SiliconCloud API: %O', {
      errorData,
      status: response.status,
      statusText: response.statusText,
    });
    throw AgentRuntimeError.createImage({
      error: {
        ...errorData,
        status: response.status,
        statusText: response.statusText,
      },
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider,
    });
  }

  const data: SiliconCloudImageResponse = await response.json();
  log('SiliconCloud API response: %O', data);

  if (!data.images || data.images.length === 0 || !data.images[0].url) {
    log('Invalid response from SiliconCloud API: no images generated. Response data: %O', data);
    throw AgentRuntimeError.createImage({
      error: { data, message: 'No images generated' },
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider,
    });
  }

  return {
    imageUrl: data.images[0].url,
  };
}
