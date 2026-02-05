import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

export interface ZeroOneModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.lingyiwanwu.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_ZEROONE_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    try {
      const modelsPage = (await client.models.list()) as any;
      const modelList: ZeroOneModelCard[] = Array.isArray(modelsPage?.data)
        ? modelsPage.data
        : Array.isArray(modelsPage)
          ? modelsPage
          : [];

      return processModelList(modelList, MODEL_LIST_CONFIGS.zeroone);
    } catch (error) {
      console.warn(
        'Failed to fetch ZeroOne models. Please ensure your ZeroOne API key is valid:',
        error,
      );
      return [];
    }
  },
  provider: ModelProvider.ZeroOne,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeZeroOneAI = createOpenAICompatibleRuntime(params);
