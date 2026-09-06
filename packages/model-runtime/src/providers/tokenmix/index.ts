import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface TokenMixModelCard {
  id: string;
}

export const LobeTokenMixAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.tokenmix.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_TOKENMIX_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: TokenMixModelCard[] = modelsPage.data;

    return processMultiProviderModelList(modelList, 'tokenmix');
  },
  provider: ModelProvider.TokenMix,
});
