import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

interface LLMAPIModelCard {
  id: string;
  object: string;
  owned_by?: string;
}

export const params = {
  baseURL: 'https://api.llmapi.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_LLMAPI_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    let modelList: LLMAPIModelCard[] = [];

    try {
      const modelsPage = (await client.models.list()) as any;
      modelList = modelsPage.data || [];
    } catch (error) {
      console.error('Failed to fetch LLM API models:', error);
      return [];
    }

    const formattedModels = modelList.map((model) => {
      // Generate display name: strip vendor prefix for cleaner display
      // e.g., "anthropic/claude-sonnet-4-5" → "Claude Sonnet 4.5"
      let displayName = model.id;
      const slashIndex = displayName.indexOf('/');
      if (slashIndex !== -1) {
        displayName = displayName.slice(slashIndex + 1);
      }

      return {
        displayName,
        id: model.id,
      };
    });

    return await processMultiProviderModelList(formattedModels, 'llmapi');
  },
  provider: ModelProvider.LLMAPI,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeLLMAPIAI = createOpenAICompatibleRuntime(params);
