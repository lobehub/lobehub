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
  id?: string;
  job_id?: string;
  request_id?: string;
}

interface HunyuanImageQueryResponse {
  data?: Array<{
    url: string;
    revised_prompt?: string;
  }> | null;
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
  object?: string;
  request_id?: string;
  status?: string;
}

const normalizeModel = (model: string): string => model?.toLowerCase() ?? '';

const isLiteModel = (model: string): boolean => normalizeModel(model).includes('hy-image-lite');

export async function createHunyuanImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { apiKey, provider } = options;
  const { model, params } = payload;

  const baseURL = options.baseURL || 'https://tokenhub.tencentmaas.com/v1';

  try {
    log('Starting Hunyuan image generation with model: %s and params: %O', model, params);

    const requestBody: Record<string, any> = {
      model,
      prompt: params.prompt,
      ...(params.width && params.height
        ? { resolution: `${params.width}:${params.height}` }
        : params.size
          ? { resolution: params.size.replace(/x/i, ':') }
          : { resolution: '1024:1024' }),
      ...(params.imageUrls && params.imageUrls.length > 0
        ? { images: params.imageUrls }
        : params.imageUrl
          ? { images: [params.imageUrl] }
          : {}),
      ...(params.promptExtend && { revise: params.promptExtend === true ? 1 : 0 }),
      ...(params.watermark && { logo_add: params.watermark === true ? 1 : 0 }),
      ...(typeof params.seed === 'number' ? { seed: params.seed } : {}),
      ...(isLiteModel(model) ? { rsp_img_type: 'url' } : {}),
    };

    if (isLiteModel(model)) {
      const submitUrl = `${baseURL}/api/image/lite`;
      log('Submitting lite image task to: %s', submitUrl);
      log('Submit body: %O', requestBody);

      const submitResponse = await fetch(submitUrl, {
        body: JSON.stringify(requestBody),
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
        } catch (error) {
          void error;
        }

        const errorMessage =
          typeof errorData?.error?.message === 'string'
            ? errorData.error.message
            : typeof errorData?.message === 'string'
              ? errorData.message
              : JSON.stringify(errorData || submitResponse.statusText);

        throw new Error(
          `Hunyuan API lite submit error (${submitResponse.status}): ${errorMessage}`,
        );
      }

      const submitData: HunyuanImageQueryResponse = await submitResponse.json();
      log('Lite submit response: %O', submitData);

      if (submitData.error?.message) {
        throw new Error(`Hunyuan API error: ${submitData.error.message}`);
      }

      if (!submitData.data || !Array.isArray(submitData.data) || submitData.data.length === 0) {
        throw new Error('Lite image task returned no images');
      }

      const imageUrl = submitData.data[0].url;
      if (!imageUrl) {
        throw new Error('No valid image URL in lite response');
      }

      log('Lite image generation completed successfully: %s', imageUrl);
      return { imageUrl };
    }

    const submitUrl = `${baseURL}/api/image/submit`;
    log('Submitting task to: %s', submitUrl);
    log('Submit body: %O', requestBody);

    const submitResponse = await fetch(submitUrl, {
      body: JSON.stringify(requestBody),
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
      } catch (error) {
        void error;
      }

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

    const jobId = submitData.id || submitData.job_id;
    if (!jobId) {
      throw new Error(
        `No job id returned from submit endpoint. Response: ${JSON.stringify(submitData)}`,
      );
    }

    log('Task submitted successfully, job id: %s', jobId);

    const queryUrl = `${baseURL}/api/image/query`;

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

        if (!status) {
          return {
            error: new Error('Invalid query response: missing status'),
            status: 'failed',
          };
        }

        log('Task status: %s', status);

        if (status === 'completed') {
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

        if (status === 'failed') {
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
        log('Polling task status for job id: %s', jobId);

        const queryResponse = await fetch(queryUrl, {
          body: JSON.stringify({ model, id: jobId }),
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
          } catch (error) {
            void error;
          }

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
