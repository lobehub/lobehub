import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const params = {
  baseURL: 'https://crowllm.com/v1',
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;

    return processMultiProviderModelList(modelsPage.data, 'crowllm');
  },
  provider: ModelProvider.CrowLLM,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeCrowLLM = createOpenAICompatibleRuntime(params);
