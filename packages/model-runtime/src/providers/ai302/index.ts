import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatCompletionErrorPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface Ai302ModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.302.ai/v1',
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
    chatCompletion: () => process.env.DEBUG_AI302_CHAT_COMPLETION === '1',
  },
  errorType: {
    bizError: AgentRuntimeErrorType.ProviderBizError,
    invalidAPIKey: AgentRuntimeErrorType.InvalidProviderAPIKey,
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: Ai302ModelCard[] = modelsPage.data;

    return processMultiProviderModelList(modelList, 'ai302');
  },
  provider: ModelProvider.Ai302,
} satisfies OpenAICompatibleFactoryOptions;

export const Lobe302AI = createOpenAICompatibleRuntime(params);
