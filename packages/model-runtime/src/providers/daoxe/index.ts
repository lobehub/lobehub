import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface DaoXEModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://daoxe.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_DAOXE_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: DaoXEModelCard[] = modelsPage.data || [];

    return processMultiProviderModelList(modelList, ModelProvider.DaoXE);
  },
  provider: ModelProvider.DaoXE,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeDaoXEAI = createOpenAICompatibleRuntime(params);
