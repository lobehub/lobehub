import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { createWenxinImage } from './createImage';

export interface WenxinModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://qianfan.baidubce.com/v2',
  chatCompletion: {
    handlePayload: (payload) => {
      const { enabledSearch, thinking, ...rest } = payload;

      return {
        ...rest,
        stream: true,
        ...(enabledSearch && {
          web_search: {
            enable: true,
            enable_citation: true,
            enable_trace: true,
          },
        }),
        ...(thinking && {
          enable_thinking: thinking.type
            ? thinking.type !== 'disabled'
            : undefined,
          ...(thinking?.budget_tokens !== 0 && {
            thinking_budget: Math.min(Math.max(thinking?.budget_tokens, 100), 16_384),
          }),
        }),
      } as any;
    },
  },
  createImage: createWenxinImage,
  debug: {
    chatCompletion: () => process.env.DEBUG_WENXIN_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: WenxinModelCard[] = modelsPage.data;

    const standardModelList = modelList.map((model) => ({
      id: model.id,
    }));

    return processMultiProviderModelList(standardModelList, 'wenxin');
  },
  provider: ModelProvider.Wenxin,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeWenxinAI = createOpenAICompatibleRuntime(params);
