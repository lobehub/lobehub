import { ModelProvider } from 'model-bank';

import { type OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

// Models that support preserved thinking (enable_thinking + clear_thinking parameters)
// Ref: https://docs.z.ai/guides/capabilities/thinking-mode#preserved-thinking
const supportPreservedThinkingModels = new Set(['z-ai/glm4.7', 'z-ai/glm5']);

export interface NvidiaModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://integrate.api.nvidia.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, thinking, messages, ...rest } = payload;

      // Convert reasoning to reasoning_content for NVIDIA API format
      // NVIDIA NIM requires reasoning_content instead of reasoning for all models
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

      // Convert thinking.type to boolean for API
      const thinkingFlag =
        thinking?.type === 'enabled' ? true : thinking?.type === 'disabled' ? false : undefined;

      // Check if model uses preserved thinking (enable_thinking + clear_thinking)
      const usePreservedThinking = model && supportPreservedThinkingModels.has(model);

      const chatTemplateKwargs: Record<string, any> = {};

      if (thinkingFlag !== undefined) {
        if (usePreservedThinking) {
          // Models with preserved thinking: use enable_thinking + clear_thinking
          // set clear_thinking to false to preserve reasoning content across turns
          chatTemplateKwargs.enable_thinking = thinkingFlag;
          chatTemplateKwargs.clear_thinking = false;
        } else {
          // Other models: use thinking parameter
          chatTemplateKwargs.thinking = thinkingFlag;
        }
      }

      return {
        ...rest,
        model,
        messages: processedMessages,
        // Send chat_template_kwargs when thinking is explicitly set
        ...(Object.keys(chatTemplateKwargs).length > 0
          ? { chat_template_kwargs: chatTemplateKwargs }
          : {}),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_NVIDIA_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: NvidiaModelCard[] = modelsPage.data;

    return processMultiProviderModelList(modelList, 'nvidia');
  },
  provider: ModelProvider.Nvidia,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeNvidiaAI = createOpenAICompatibleRuntime(params);
