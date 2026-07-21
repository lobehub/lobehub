import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface AiOnlyModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.aionly.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_AIONLY_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as { data?: AiOnlyModelCard[] };
    const modelList: AiOnlyModelCard[] = modelsPage.data || [];

    return processMultiProviderModelList(modelList, 'aionly');
  },
  provider: ModelProvider.AiOnly,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeAiOnlyAI = createOpenAICompatibleRuntime(params);
