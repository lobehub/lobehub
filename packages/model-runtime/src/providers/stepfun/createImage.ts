import createDebug from 'debug';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';

const log = createDebug('lobe-image:stepfun');

interface StepfunImageDataItem {
  b64_json?: string;
  finish_reason?: string;
  seed?: number;
  url?: string;
}

interface StepfunImageResponse {
  created?: number;
  data?: StepfunImageDataItem[];
  id?: string;
}

export async function createStepfunImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { apiKey, baseURL, provider } = options;
  const { model, params } = payload;
  const { cfg, imageUrl, prompt, seed, size, steps } = params;

  try {
    let endpoint = imageUrl ? 'edits' : 'generations';

    const body: Record<string, any> = {
      model,
      n: 1, // Only supports generating 1 image at a time
      prompt,
      response_format: 'url',
      ...(cfg !== undefined ? { cfg_scale: cfg } : {}),
      ...(seed !== undefined ? { seed } : {}),
      ...(size !== undefined ? { size } : {}),
      ...(steps !== undefined ? { steps } : {}),
      ...(model === 'step-image-edit-2' ? { text_mode: true } : {}),
    };

    if (imageUrl) {
      if (model === 'step-1x-medium') {
        // For step-1x-medium, endpoint is "image2image" and the imageUrl should be passed as "source_url" in the body
        endpoint = 'image2image';
        body.source_url = imageUrl;
        body.source_weight = 0.5;
      } else {
        // For other models, the imageUrl should be passed as "image" in the body
        body.image = imageUrl;
      }
    }

    log('Calling Stepfun image API: %s with body: %O', endpoint, body);

    const res = await fetch(`${baseURL}/images/${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let errBody: any = undefined;
      try {
        errBody = await res.json();
      } catch {
        // ignore
      }
      throw new Error(
        `Stepfun image API error: ${res.status} ${res.statusText} ${
          errBody ? JSON.stringify(errBody) : ''
        }`,
      );
    }

    const data: StepfunImageResponse = await res.json();
    log('Stepfun image response: %O', data);

    if (!data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new Error('No image data returned from Stepfun');
    }

    const first = data.data[0];
    if (!first) throw new Error('Empty image item');

    if (first.url) {
      return { imageUrl: first.url };
    }

    throw new Error('Unsupported image response format from Stepfun');
  } catch (error) {
    log('Error creating Stepfun image: %O', error);
    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
