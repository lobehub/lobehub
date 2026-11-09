import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface JalapenoCloudModelCard {
  id: string;
  object?: string;
  owned_by?: string;
}

export const params = {
  baseURL: 'https://api.jalapeno-cloud.ai/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, thinking, ...rest } = payload;
      const thinkingFlag =
        thinking?.type === 'enabled' ? true : thinking?.type === 'disabled' ? false : undefined;

      return {
        ...rest,
        model,
        ...(thinkingFlag === undefined
          ? {}
          : { chat_template_kwargs: { thinking: thinkingFlag } }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_JALAPENOCLOUD_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const rawList: any[] = modelsPage.data || [];

    const modelList: JalapenoCloudModelCard[] = rawList.map((model) => ({
      id: model.id,
      object: model.object,
      owned_by: model.owned_by,
    }));

    return processMultiProviderModelList(modelList, 'jalapenocloud');
  },
  provider: ModelProvider.JalapenoCloud,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeJalapenoCloudAI = createOpenAICompatibleRuntime(params);
