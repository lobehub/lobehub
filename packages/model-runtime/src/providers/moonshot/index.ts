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
    handlePayload: (payload: ChatStreamPayload) => {
      const { enabledSearch, messages, temperature, tools, ...rest } = payload;

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

      // Resolve parameters with normalization
      const resolvedParams = resolveParameters({ temperature }, { normalizeTemperature: true });

      return {
        ...rest,
        messages: filteredMessages,
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
