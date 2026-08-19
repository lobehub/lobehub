import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const params = {
  apiKey: 'placeholder-to-avoid-error',
  baseURL: 'https://openai.qiniu.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_QINIU_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList = modelsPage.data.map((model: any) => {
      const { created: _created, context_length, max_tokens, ...rest } = model;
      // Rename Qiniu's snake_case length fields to the card fields
      // processMultiProviderModelList actually reads, so they aren't dropped
      return {
        ...rest,
        contextWindowTokens: context_length,
        maxOutput: max_tokens,
      };
    });

    // Auto-detect the model provider and select the corresponding configuration
    return processMultiProviderModelList(modelList, 'qiniu');
  },
  provider: ModelProvider.Qiniu,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeQiniuAI = createOpenAICompatibleRuntime(params);
