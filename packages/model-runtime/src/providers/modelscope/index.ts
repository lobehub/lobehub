import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface ModelScopeModelCard {
  created: number;
  id: string;
  object: string;
  owned_by: string;
}

export const params = {
  baseURL: 'https://api-inference.modelscope.cn/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_MODELSCOPE_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: ModelScopeModelCard[] = modelsPage.data || [];

    return await processMultiProviderModelList(modelList, 'modelscope');
  },
  provider: ModelProvider.ModelScope,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeModelScopeAI = createOpenAICompatibleRuntime(params);
