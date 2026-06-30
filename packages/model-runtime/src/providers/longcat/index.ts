import { longcat as longcatChatModels, ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import { getModelMaxOutputs } from '../../utils/getModelMaxOutputs';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

export interface LongCatModelCard {
  id: string;
}

export const LobeLongCatAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.longcat.chat/openai/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const {
        frequency_penalty: _frequency_penalty,
        max_tokens,
        presence_penalty: _presence_penalty,
        temperature,
        thinking,
        ...rest
      } = payload;

      const { temperature: normalizedTemperature } = resolveParameters(
        { temperature },
        { normalizeTemperature: true, temperatureRange: { min: 0, max: 1 } },
      );

      return {
        ...rest,
        frequency_penalty: undefined,
        max_tokens:
          max_tokens !== undefined
            ? max_tokens
            : getModelMaxOutputs(payload.model, longcatChatModels),
        presence_penalty: undefined,
        stream: true,
        temperature: normalizedTemperature,
        ...(thinking && {
          thinking: {
            type: thinking.type === 'enabled' ? 'enabled' : 'disabled',
          },
        }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_LONGCAT_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: LongCatModelCard[] = modelsPage.data;

    const standardModelList = modelList.map((model) => ({
      id: model.id,
    }));
    return processModelList(standardModelList, MODEL_LIST_CONFIGS.longcat, 'longcat');
  },
  provider: ModelProvider.LongCat,
});
