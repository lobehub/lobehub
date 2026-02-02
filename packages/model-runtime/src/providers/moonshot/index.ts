import { ModelProvider } from 'model-bank';

import {
  type OpenAICompatibleFactoryOptions,
  createOpenAICompatibleRuntime,
} from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import { ChatStreamPayload } from '../../types';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

export interface MoonshotModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.moonshot.cn/v1',
  chatCompletion: {
    forceImageBase64: true,
    handlePayload: (payload: ChatStreamPayload) => {
      const { enabledSearch, messages, model, temperature, thinking, tools, ...rest } = payload;

      const filteredMessages = messages.map((message: any) => {
        let normalizedMessage = message;

        // Add a space for empty assistant messages (#8418)
        if (message.role === 'assistant' && (!message.content || message.content === '')) {
          normalizedMessage = { ...normalizedMessage, content: ' ' };
        }

        // Interleaved thinking
        if (message.role === 'assistant' && message.reasoning) {
          const { reasoning, ...messageWithoutReasoning } = normalizedMessage;
          return {
            ...messageWithoutReasoning,
            ...(!reasoning.signature && reasoning.content
              ? { reasoning_content: reasoning.content }
              : {}),
          };
        }
        return normalizedMessage;
      });

      const moonshotTools = enabledSearch
        ? [
            ...(tools || []),
            {
              function: {
                name: '$web_search',
              },
              type: 'builtin_function',
            },
          ]
        : tools;

      const isK25Model = model === 'kimi-k2.5';

      if (isK25Model) {
        const thinkingParam =
          thinking?.type === 'disabled' ? { type: 'disabled' } : { type: 'enabled' };
        const isThinkingEnabled = thinkingParam.type === 'enabled';

        return {
          ...rest,
          frequency_penalty: 0,
          messages: filteredMessages,
          model,
          presence_penalty: 0,
          temperature: isThinkingEnabled ? 1 : 0.6,
          thinking: thinkingParam,
          tools: moonshotTools,
          top_p: 0.95,
        } as any;
      }

      // Resolve parameters with normalization for non-K2.5 models
      const resolvedParams = resolveParameters({ temperature }, { normalizeTemperature: true });

      return {
        ...rest,
        messages: filteredMessages,
        model,
        temperature: resolvedParams.temperature,
        tools: moonshotTools,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_MOONSHOT_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: MoonshotModelCard[] = modelsPage.data;

    return processModelList(modelList, MODEL_LIST_CONFIGS.moonshot, 'moonshot');
  },
  provider: ModelProvider.Moonshot,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeMoonshotAI = createOpenAICompatibleRuntime(params);
