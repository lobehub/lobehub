import { ModelProvider } from 'model-bank';

import { type OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { type ChatCompletionErrorPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { createSiliconCloudImage } from './createImage';
import { createSiliconCloudVideo } from './createVideo';

export interface SiliconCloudModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.siliconflow.cn/v1',
  chatCompletion: {
    handleError: (error: any): Omit<ChatCompletionErrorPayload, 'provider'> | undefined => {
      let errorResponse: Response | undefined;
      if (error instanceof Response) {
        errorResponse = error;
      } else if ('status' in (error as any)) {
        errorResponse = error as Response;
      }

      if (errorResponse) {
        if (errorResponse.status === 401) {
          return {
            error: errorResponse.status,
            errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
          };
        }

        if (errorResponse.status === 403) {
          return {
            error: errorResponse.status,
            errorType: AgentRuntimeErrorType.ProviderBizError,
            message:
              'Please check if your API Key balance is sufficient, or if you are using an unverified API Key to access models that require verification.',
          };
        }
      }

      if (error?.error || error?.code || error?.message) {
        const errorData = error?.error?.error || error?.error || error;
        const { code, message, data } = errorData;

        if (code || message || data) {
          return {
            error: { code, data, message },
          };
        }
      }
      return {
        error: { message: error?.message || error?.error?.message },
      };
    },
    handlePayload: (payload) => {
      const { max_tokens, model, thinking, reasoning_effort, messages, ...rest } = payload;

      // Format conversion: reasoning → reasoning_content
      const processedMessages = messages?.map((message: any) => {
        if (message.role === 'assistant' && message.reasoning?.content) {
          const { reasoning, ...restMessage } = message;
          return {
            ...restMessage,
            reasoning_content: reasoning.content,
          };
        }
        return message;
      });

      const result: any = {
        ...rest,
        max_tokens:
          max_tokens === undefined ? undefined : Math.min(Math.max(max_tokens, 1), 16_384),
        model,
        messages: processedMessages,
      };

      const thinkingExplicitlyDisabled = thinking?.type === 'disabled';

      if (thinking) {
        if (typeof thinking.type !== 'undefined') {
          result.enable_thinking = thinking.type === 'enabled';
        }
        const thinkingBudget = thinking.budget_tokens === 0 ? 1 : thinking.budget_tokens;
        if (typeof thinkingBudget !== 'undefined') {
          result.thinking_budget = Math.min(Math.max(thinkingBudget, 128), 32_768);
        }
      }

      // SiliconCloud supports reasoning_effort for deepseek-ai/DeepSeek-V4-Flash.
      // It should not be sent when thinking is explicitly disabled.
      if (!thinkingExplicitlyDisabled && reasoning_effort) {
        result.reasoning_effort = reasoning_effort;
      }

      return result;
    },
  },
  createImage: createSiliconCloudImage,
  createVideo: createSiliconCloudVideo,
  handlePollVideoStatus: async (inferenceId, options) => {
    const { pollSiliconCloudVideoStatus } = await import('./createVideo');
    return pollSiliconCloudVideoStatus(inferenceId, {
      apiKey: options.apiKey,
      baseURL: options.baseURL || '',
    });
  },
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
