import createDebug from 'debug';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { asyncifyPolling } from '../../utils/asyncifyPolling';
import { AgentRuntimeError } from '../../utils/createError';

const log = createDebug('lobe-image:hunyuan');

interface HunyuanImageSubmitResponse {
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
  job_id?: string;
  request_id?: string;
}

interface HunyuanImageQueryResponse {
  data?: Array<{
    url: string;
  }> | null;
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
  request_id?: string;
  status?: string;
}

// Hunyuan3.0 ImageGen Status Code
// https://cloud.tencent.com/document/product/1668/124633
const getStatusName = (status: string): string => {
  const statusMap: Record<string, string> = {
    '1': 'PENDING',
    '2': 'PROCESSING',
    '4': 'FAILED',
    '5': 'COMPLETED',
  };
  return statusMap[status] || `UNKNOWN(${status})`;
};

export async function createHunyuanImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { apiKey, provider } = options;
  const { model, params } = payload;

  // Hunyuan3.0 ImageGen BaseURL
  // https://cloud.tencent.com/document/product/1668/129429
  const baseURL = options.baseURL || 'https://api.cloudai.tencent.com/v1';

  try {
    log('Starting Hunyuan image generation with model: %s and params: %O', model, params);

    const submitUrl = `${baseURL}/aiart/submit`;
    const submitBody: Record<string, any> = {
      model,
      prompt: params.prompt,
      ...(params.width && params.height
        ? { size: `${params.width}:${params.height}` }
        : params.size
          ? { size: params.size.replace('x', ':') }
          : { size: '1024:1024' }),
      ...(params.imageUrls && params.imageUrls.length > 0
        ? { images: params.imageUrls }
        : params.imageUrl
          ? { images: [params.imageUrl] }
          : {}),
      extra_body: {
        logo_add: 0, // Add Watermark: 0 disabled, 1 enabled
        ...(typeof params.seed === 'number' ? { seed: params.seed } : {}),
      },
    };

    log('Submitting task to: %s', submitUrl);
    log('Submit body: %O', submitBody);

    const submitResponse = await fetch(submitUrl, {
      body: JSON.stringify(submitBody),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!submitResponse.ok) {
      let errorData;
      try {
        errorData = await submitResponse.json();
      } catch {}

      const errorMessage =
        typeof errorData?.error?.message === 'string'
          ? errorData.error.message
          : typeof errorData?.message === 'string'
            ? errorData.message
            : JSON.stringify(errorData || submitResponse.statusText);

      throw new Error(`Hunyuan API submit error (${submitResponse.status}): ${errorMessage}`);
    }

    const submitData: HunyuanImageSubmitResponse = await submitResponse.json();
    log('Submit response: %O', submitData);

    if (submitData.error?.message) {
      throw new Error(`Hunyuan API error: ${submitData.error.message}`);
    }

    if (!submitData.job_id) {
      throw new Error(
        `No job_id returned from submit endpoint. Response: ${JSON.stringify(submitData)}`,
      );
    }

    const jobId = submitData.job_id;
    log('Task submitted successfully, job_id: %s', jobId);

    const queryUrl = `${baseURL}/aiart/query`;

    const result = await asyncifyPolling<HunyuanImageQueryResponse, CreateImageResponse>({
      checkStatus: (taskStatus: HunyuanImageQueryResponse): any => {
        log('Checking task status: %O', taskStatus);

        if (taskStatus.error?.message) {
          log('API error response: %s', taskStatus.error.message);
          return {
            error: new Error(`Hunyuan API error: ${taskStatus.error.message}`),
            status: 'failed',
          };
        }

        const status = taskStatus.status;

        // Status return an empty string if query got an error
        if (!status) {
          return {
            error: new Error('Invalid query response: missing status'),
            status: 'failed',
          };
        }

        log('Task status: %s', getStatusName(status));

        // Task completed
        if (status === '5') {
          if (!taskStatus.data || !Array.isArray(taskStatus.data) || taskStatus.data.length === 0) {
            return {
              error: new Error('Task completed but no images generated'),
              status: 'failed',
            };
          }

          const imageUrl = taskStatus.data[0].url;
          if (!imageUrl) {
            return {
              error: new Error('No valid image URL in response'),
              status: 'failed',
            };
          }

          log('Image generation completed successfully: %s', imageUrl);
          return {
            data: { imageUrl },
            status: 'success',
          };
        }

        // Task failed
        if (status === '4') {
          return {
            error: new Error('Task failed'),
            status: 'failed',
          };
        }

        return { status: 'pending' };
      },
      logger: {
        debug: (message: any, ...args: any[]) => log(message, ...args),
        error: (message: any, ...args: any[]) => log(message, ...args),
      },
      maxConsecutiveFailures: 5,
      maxRetries: 60,
      pollingQuery: async () => {
        log('Polling task status for job_id: %s', jobId);

        const queryResponse = await fetch(queryUrl, {
          body: JSON.stringify({ job_id: jobId }),
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
        });

        if (!queryResponse.ok) {
          let errorData;
          try {
            errorData = await queryResponse.json();
          } catch {}

          const errorMessage =
            typeof errorData?.message === 'string'
              ? errorData.message
              : JSON.stringify(errorData || queryResponse.statusText);

          throw new Error(`Hunyuan API query error (${queryResponse.status}): ${errorMessage}`);
        }

        return await queryResponse.json();
      },
    });

    log('Image generation completed: %O', result);
    return result;
  } catch (error) {
    log('Error in createHunyuanImage: %O', error);

    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
