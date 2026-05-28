import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

export interface InternLMModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://chat.intern-ai.org.cn/api/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { thinking, ...rest } = payload as any;

      return {
        ...rest,
        ...(thinking?.type !== undefined && {
          thinking_mode: thinking.type === 'enabled',
        }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_INTERNLM_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: InternLMModelCard[] = modelsPage.data;

    return processModelList(modelList, MODEL_LIST_CONFIGS.internlm, 'internlm');
  },
  provider: ModelProvider.InternLM,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeInternLMAI = createOpenAICompatibleRuntime(params);
