import { ModelProvider } from 'model-bank';

import {
  OpenAICompatibleFactoryOptions,
  createOpenAICompatibleRuntime,
} from '../../core/openaiCompatibleFactory';
import { ChatCompletionErrorPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { createSiliconCloudImage } from './createImage';

export interface SiliconCloudModelCard {
  id: string;
}

const getByteLength = (value: string): number => {
  return new TextEncoder().encode(value).length;
};

const defaultFetch = globalThis.fetch?.bind(globalThis);

const siliconFetch: typeof fetch = async (input, init) => {
  if (!defaultFetch) return fetch(input, init);

  const response = await defaultFetch(input, init);

  if (!response || response.status < 400) return response;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return response;

  try {
    const cloned = response.clone();
    const data = await cloned.json();

    if (data && typeof data === 'object' && !('error' in data)) {
      const headers = new Headers(response.headers);
      headers.delete('content-length');

      const body = JSON.stringify({ error: data });
      headers.set('content-length', getByteLength(body).toString());

      return new Response(body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    }
  } catch {
    // ignore JSON parse errors and fall back to original response
  }

  return response;
};

export const params = {
  baseURL: 'https://api.siliconflow.cn/v1',
  chatCompletion: {
    handleError: (error: any): Omit<ChatCompletionErrorPayload, 'provider'> | undefined => {
      const status = error?.status || (error instanceof Response && error.status);

      if (status === 401) {
        return {
          error: status,
          errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        };
      }

      if (status === 403) {
        return {
          error: status,
          errorType: AgentRuntimeErrorType.ProviderBizError,
          message:
            '请检查 API Key 余额是否充足,或者是否在用未实名的 API Key 访问需要实名的模型。',
        };
      }

      if (error?.error || error?.code || error?.message) {
        // Prioritize nested error structure, then fall back to top-level fields
        const errorData = error?.error?.error || error?.error || error;
        const { code, message, data } = errorData;

        if (code || message || data) {
          return {
            error: {
              ...(code !== undefined ? { code } : {}),
              ...(typeof data !== 'undefined' ? { data } : {}),
              ...(message !== undefined ? { message } : {}),
            },
          };
        }
      }

      return { error };
    },
    handlePayload: (payload) => {
      const { max_tokens, model, thinking, ...rest } = payload;
      const thinkingBudget =
        thinking?.budget_tokens === 0 ? 1 : thinking?.budget_tokens || undefined;

      const result: any = {
        ...rest,
        max_tokens:
          max_tokens === undefined ? undefined : Math.min(Math.max(max_tokens, 1), 16_384),
        model,
      };

      if (thinking) {
        // Only set enable_thinking if type is explicitly provided
        if (typeof thinking.type !== 'undefined') {
          result.enable_thinking = thinking.type === 'enabled';
        }
        if (typeof thinkingBudget !== 'undefined') {
          result.thinking_budget = Math.min(Math.max(thinkingBudget, 128), 32_768);
        }
      }
      return result;
    },
  },
  constructorOptions: {
    fetch: siliconFetch,
  },
  createImage: createSiliconCloudImage,
  debug: {
    chatCompletion: () => process.env.DEBUG_SILICONCLOUD_CHAT_COMPLETION === '1',
  },
  errorType: {
    bizError: AgentRuntimeErrorType.ProviderBizError,
    invalidAPIKey: AgentRuntimeErrorType.InvalidProviderAPIKey,
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: SiliconCloudModelCard[] = modelsPage.data;

    return processMultiProviderModelList(modelList, 'siliconcloud');
  },
  provider: ModelProvider.SiliconCloud,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeSiliconCloudAI = createOpenAICompatibleRuntime(params);
