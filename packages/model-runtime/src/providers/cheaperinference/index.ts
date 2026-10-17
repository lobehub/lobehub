import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface CheaperInferenceModelCard {
  context_length?: number;
  id: string;
  max_output_tokens?: number;
  type?: string;
}

export const params = {
  baseURL: 'https://api.cheaperinference.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_CHEAPERINFERENCE_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_CHEAPERINFERENCE_RESPONSES === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: CheaperInferenceModelCard[] = modelsPage.data || [];

    // The model list also contains image and video models; this provider exposes chat only.
    const formattedModels = modelList
      .filter((model) => !model.type || model.type === 'text')
      .map((model) => ({
        contextWindowTokens: model.context_length,
        id: model.id,
        maxOutput: model.max_output_tokens,
        type: 'chat',
      }));

    return processMultiProviderModelList(formattedModels, 'cheaperinference');
  },
  provider: ModelProvider.CheaperInference,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeCheaperInferenceAI = createOpenAICompatibleRuntime(params);
