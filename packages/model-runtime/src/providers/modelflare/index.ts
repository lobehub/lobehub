import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatCompletionErrorPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface ModelflareModelCard {
  id: string;
  /** Endpoint families the model is served on, e.g. `openai`, `anthropic`, `image-generation`. */
  supported_endpoint_types?: string[];
}

/**
 * Only models reachable through OpenAI Chat Completions are usable with this runtime;
 * image/video-only models are returned by `/v1/models` but use other endpoints.
 * Models without explicit endpoint metadata are rejected, since there is no evidence
 * that Chat Completions serves them.
 */
export const isChatCompletionsModel = (model: ModelflareModelCard) =>
  Array.isArray(model.supported_endpoint_types) &&
  model.supported_endpoint_types.includes('openai');

export const params = {
  baseURL: 'https://modelflare.dev/v1',
  chatCompletion: {
    handleError: (error: any): Omit<ChatCompletionErrorPayload, 'provider'> | undefined => {
      let errorResponse: Response | undefined;
      if (error instanceof Response) {
        errorResponse = error;
      } else if ('status' in (error as any)) {
        errorResponse = error as Response;
      }
      if (errorResponse && errorResponse.status === 401) {
        return {
          error: errorResponse.status,
          errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        };
      }

      return {
        error,
      };
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_MODELFLARE_CHAT_COMPLETION === '1',
  },
  errorType: {
    bizError: AgentRuntimeErrorType.ProviderBizError,
    invalidAPIKey: AgentRuntimeErrorType.InvalidProviderAPIKey,
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: ModelflareModelCard[] = (modelsPage.data ?? []).filter(isChatCompletionsModel);

    return processMultiProviderModelList(modelList, 'modelflare');
  },
  provider: ModelProvider.Modelflare,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeModelflareAI = createOpenAICompatibleRuntime(params);
