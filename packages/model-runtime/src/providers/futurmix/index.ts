import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const LobeFuturMixAI = createOpenAICompatibleRuntime({
  baseURL: 'https://futurmix.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_FUTURMIX_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList = modelsPage.data || [];

    return modelList.map((model: any) => ({
      contextWindowTokens: model.context_window || model.max_tokens,
      description: model.description,
      displayName: model.display_name || model.id,
      id: model.id,
      maxOutput: model.max_output_tokens || model.max_tokens,
    }));
  },
  provider: ModelProvider.FuturMix,
});
