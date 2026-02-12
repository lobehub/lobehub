import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface GiteeAIModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://ai.gitee.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_GITEE_AI_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    try {
      const modelsPage = (await client.models.list()) as any;
      const modelList: GiteeAIModelCard[] = Array.isArray(modelsPage?.data)
        ? modelsPage.data
        : Array.isArray(modelsPage)
          ? modelsPage
          : [];

      return await processMultiProviderModelList(modelList, 'giteeai');
    } catch (error) {
      console.warn(
        'Failed to fetch GiteeAI models. Please ensure your GiteeAI API key is valid:',
        error,
      );
      return [];
    }
  },
  provider: ModelProvider.GiteeAI,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeGiteeAI = createOpenAICompatibleRuntime(params);
