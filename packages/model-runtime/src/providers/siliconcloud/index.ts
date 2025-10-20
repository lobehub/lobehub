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
              '请检查 API Key 余额是否充足，或者是否在用未实名的 API Key 访问需要实名的模型。',
          };
        }
      }
      return {
        error,
      };
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
        // 只有部分模型支持指定 enable_thinking，其余一些慢思考模型只支持调节 thinking budget
        const hybridThinkingModels = [
          /GLM-4\.5(?!.*Air$)/, // GLM-4.5 和 GLM-4.5V（不包含 GLM-4.5 Air）
          /Qwen3-(?:\d+B|\d+B-A\d+B)$/, // Qwen3-8B、Qwen3-14B、Qwen3-32B、Qwen3-30B-A3B、Qwen3-235B-A22B
          /DeepSeek-V3\.1/,
          /Hunyuan-A13B-Instruct/,
        ];
        if (hybridThinkingModels.some((regexp) => regexp.test(model))) {
          result.enable_thinking = thinking.type === 'enabled';
        }
        if (typeof thinkingBudget !== 'undefined') {
          result.thinking_budget = Math.min(Math.max(thinkingBudget, 1), 32_768);
        }
      }
      return result;
    },
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
