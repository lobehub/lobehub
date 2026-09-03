import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface AvalAIModelCard {
  id: string;
  object: string;
  owned_by: string;
}

export const params = {
  baseURL: 'https://api.avalai.ir/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_AVALAI_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const rawList: any[] = modelsPage.data || [];

    // Process the model list and remove unnecessary fields
    const modelList: AvalAIModelCard[] = rawList.map((model) => ({
      id: model.id,
      object: model.object,
      owned_by: model.owned_by,
    }));

    return await processMultiProviderModelList(modelList, 'avalai');
  },
  provider: ModelProvider.AvalAI,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeAvalAI = createOpenAICompatibleRuntime(params);
