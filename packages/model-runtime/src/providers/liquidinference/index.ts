import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { LiquidInferenceModelCard } from './type';

export const LobeLiquidInferenceAI = createOpenAICompatibleRuntime({
  baseURL: 'https://router.inference.ai.exchange/v1',
  constructorOptions: {
    defaultHeaders: {
      'X-Title': 'LobeHub',
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_LIQUIDINFERENCE_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const modelsPage = (await client.models.list()) as any;
    const modelList: LiquidInferenceModelCard[] = modelsPage.data;

    return modelList
      .filter((model) => !model.kind || model.kind === 'chat')
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );
        const parameters = model.liquid_supported_parameters ?? [];

        return {
          contextWindowTokens: model.context_length ?? knownModel?.contextWindowTokens,
          created: model.created,
          displayName: knownModel?.displayName ?? model.id,
          enabled: knownModel?.enabled || false,
          functionCall:
            parameters.includes('tools') || knownModel?.abilities?.functionCall || false,
          id: model.id,
          maxOutput: model.max_tokens,
          pricing:
            typeof model.min_input_rate === 'number' && typeof model.min_output_rate === 'number'
              ? { input: model.min_input_rate, output: model.min_output_rate }
              : undefined,
          reasoning: parameters.includes('reasoning') || knownModel?.abilities?.reasoning || false,
          vision: parameters.includes('input.image') || knownModel?.abilities?.vision || false,
        };
      }) as ChatModelCard[];
  },
  provider: ModelProvider.LiquidInference,
});
