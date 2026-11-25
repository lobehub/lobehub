import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface LlmtrModelCard {
  id: string;
  object?: string;
  owned_by?: string;
}

export const params = {
  baseURL: 'https://llmtr.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_LLMTR_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const rawList: any[] = modelsPage.data || [];

    const modelList: LlmtrModelCard[] = rawList.map((model) => ({
      id: model.id,
      object: model.object,
      owned_by: model.owned_by,
    }));

    return await processMultiProviderModelList(modelList, 'llmtr');
  },
  provider: ModelProvider.LLMTR,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeLLMTRAI = createOpenAICompatibleRuntime(params);
