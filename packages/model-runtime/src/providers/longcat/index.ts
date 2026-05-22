import type { ChatModelCard } from '@lobechat/types';
import { longcat as longchatCahtModels, ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { getModelMaxOutputs } from '../../utils/getModelMaxOutputs';

export interface LongCatModelCard {
  id: string;
}

export const LobeLongCatAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.longcat.chat/openai/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { frequency_penalty, max_tokens, presence_penalty, ...rest } = payload;

      return {
        ...rest,
        frequency_penalty: undefined,
        max_tokens:
          max_tokens !== undefined
            ? max_tokens
            : getModelMaxOutputs(payload.model, longchatCahtModels),
        presence_penalty: undefined,
        stream: true,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_LONGCAT_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const modelsPage = (await client.models.list()) as any;
    const modelList: LongCatModelCard[] = modelsPage.data;

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
  provider: ModelProvider.LongCat,
});
