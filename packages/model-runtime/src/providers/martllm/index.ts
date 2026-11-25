import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import { processMultiProviderModelList } from '../../utils/modelParse';

// The fields of MartLLM's GET /v1/models that are used here.
export interface MartLLMModelCard {
  context_length?: number;
  display_name?: string;
  id: string;
  max_output_tokens?: number;
  supports_reasoning?: boolean;
  supports_tools?: boolean;
  supports_vision?: boolean;
}

export const params = {
  baseURL: 'https://api.martllm.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_MARTLLM_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const rawList: MartLLMModelCard[] = modelsPage.data || [];

    // MartLLM reports each model's limits and abilities itself, so they are
    // passed on as given instead of being guessed from the model id.
    const modelList = rawList.map((model) => ({
      contextWindowTokens: model.context_length,
      displayName: model.display_name,
      functionCall: model.supports_tools,
      id: model.id,
      maxOutput: model.max_output_tokens,
      reasoning: model.supports_reasoning,
      vision: model.supports_vision,
    }));

    return await processMultiProviderModelList(modelList, 'martllm');
  },
  provider: ModelProvider.MartLLM,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeMartLLMAI = createOpenAICompatibleRuntime(params);
