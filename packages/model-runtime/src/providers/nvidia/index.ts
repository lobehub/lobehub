import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

const THINKING_MODELS = new Set([
  'deepseek-ai/deepseek-v3.1',
  'deepseek-ai/deepseek-v3.1-terminus',
]);

export interface NvidiaModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://integrate.api.nvidia.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, thinking, ...rest } = payload;

      const thinkingFlag =
        thinking?.type === 'enabled' ? true : thinking?.type === 'disabled' ? false : undefined;

      return {
        ...rest,
        model,
        ...(THINKING_MODELS.has(model)
          ? {
              chat_template_kwargs: { thinking: thinkingFlag },
            }
          : {}),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_NVIDIA_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: NvidiaModelCard[] = modelsPage.data;

    return processMultiProviderModelList(modelList, 'nvidia');
  },
  provider: ModelProvider.Nvidia,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeNvidiaAI = createOpenAICompatibleRuntime(params);
