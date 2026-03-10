import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

const THINKING_MODELS = new Set(['DeepSeek-V3-1']);

export interface AkashChatModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://chatapi.akash.network/api/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, thinking, ...rest } = payload;

      const thinkingFlag =
        thinking?.type === 'enabled' ? true : thinking?.type === 'disabled' ? false : undefined;

      return {
        ...rest,
        allowed_openai_params: ['reasoning_effort'],
        cache: { 'no-cache': true },
        model,
        ...(THINKING_MODELS.has(model)
          ? {
              chat_template_kwargs: { thinking: thinkingFlag },
            }
          : {}),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_AKASH_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    try {
      const modelsPage = (await client.models.list()) as any;
      const rawList: any[] = modelsPage.data || [];

      // Remove `created` field from each model item

      const modelList: AkashChatModelCard[] = rawList.map(({ created: _, ...rest }) => rest);

      return await processMultiProviderModelList(modelList, 'akashchat');
    } catch (error) {
      console.warn(
        'Failed to fetch AkashChat models. Please ensure your AkashChat API key is valid:',
        error,
      );
      return [];
    }
  },
  provider: ModelProvider.AkashChat,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeAkashChatAI = createOpenAICompatibleRuntime(params);
