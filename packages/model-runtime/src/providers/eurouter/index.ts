import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

interface EUrouterModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.eurouter.ai/api/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_EUROUTER_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: EUrouterModelCard[] = modelsPage.data || [];

    return processMultiProviderModelList(modelList, 'eurouter');
  },
  provider: ModelProvider.EUrouter,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeEUrouterAI = createOpenAICompatibleRuntime(params);
