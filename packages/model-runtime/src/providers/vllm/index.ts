import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export interface VLLMModelCard {
  id: string;
}

export const LobeVLLMAI = createOpenAICompatibleRuntime({
  baseURL: 'http://localhost:8000/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_VLLM_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const modelsPage = (await client.models.list()) as any;
    const modelList: VLLMModelCard[] = modelsPage.data;

    return modelList
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );

        return {
          contextWindowTokens: knownModel?.contextWindowTokens ?? undefined,
          displayName: knownModel?.displayName ?? undefined,
          enabled: knownModel?.enabled || false,
          functionCall: knownModel?.abilities?.functionCall || false,
          id: model.id,
          reasoning: knownModel?.abilities?.reasoning || false,
          vision: knownModel?.abilities?.vision || false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  },
  provider: ModelProvider.VLLM,
});
