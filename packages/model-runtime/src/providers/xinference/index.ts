import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export interface XinferenceModelCard {
  context_length: number;
  id: string;
  model_ability: string[];
  model_description: string;
  model_type: string;
  name: string;
}

export const LobeXinferenceAI = createOpenAICompatibleRuntime({
  baseURL: 'http://localhost:9997/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_XINFERENCE_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const modelsPage = (await client.models.list()) as any;
    const modelList: XinferenceModelCard[] = modelsPage.data;

    return modelList
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );

        return {
          contextWindowTokens: model.context_length,
          description: model.model_description,
          displayName: model.name,
          enabled: knownModel?.enabled || false,
          functionCall:
            (model.model_ability && model.model_ability.includes('tools')) ||
            knownModel?.abilities?.functionCall ||
            false,
          id: model.id,
          reasoning:
            (model.model_ability && model.model_ability.includes('reasoning')) ||
            knownModel?.abilities?.reasoning ||
            false,
          vision:
            (model.model_ability && model.model_ability.includes('vision')) ||
            knownModel?.abilities?.vision ||
            false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  },
  provider: ModelProvider.Xinference,
});
