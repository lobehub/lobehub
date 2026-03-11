import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

export interface DeepSeekModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.deepseek.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const shouldForceAssistantReasoningContent = payload.model === 'deepseek-reasoner';

      // Transform reasoning object to reasoning_content string for multi-turn conversations
      const messages = payload.messages.map((message: any) => {
        const { reasoning, ...rest } = message;

        const reasoningContent =
          typeof rest.reasoning_content === 'string'
            ? rest.reasoning_content
            : typeof reasoning?.content === 'string'
              ? reasoning.content
              : undefined;

        // DeepSeek reasoner with tool calls requires assistant history messages to carry reasoning_content
        if (message.role === 'assistant' && shouldForceAssistantReasoningContent) {
          return {
            ...rest,
            reasoning_content: reasoningContent ?? '',
          };
        }

        if (reasoningContent !== undefined) {
          return {
            ...rest,
            reasoning_content: reasoningContent,
          };
        }

        return rest;
      });

      return {
        ...payload,
        messages,
        stream: payload.stream ?? true,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION === '1',
  },
  // Deepseek don't support json format well
  // use Tools calling to simulate
  generateObject: {
    useToolsCalling: true,
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: DeepSeekModelCard[] = modelsPage.data;

    return processModelList(modelList, MODEL_LIST_CONFIGS.deepseek, 'deepseek');
  },
  provider: ModelProvider.DeepSeek,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeDeepSeekAI = createOpenAICompatibleRuntime(params);
