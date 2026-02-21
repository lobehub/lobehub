import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export interface HunyuanModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      // eslint-disable-next-line unused-imports/no-unused-vars
      const { enabledSearch, frequency_penalty, model, presence_penalty, thinking, ...rest } =
        payload;

      return {
        ...rest,
        frequency_penalty: undefined,
        model,
        presence_penalty: undefined,
        stream: true,
        ...(enabledSearch && {
          citation: true,
          enable_enhancement: true,
          /*
          enable_multimedia: true,
          */
          enable_speed_search: process.env.HUNYUAN_ENABLE_SPEED_SEARCH === '1',
          search_info: true,
        }),
        ...(model === 'hunyuan-a13b' && {
          enable_thinking:
            thinking?.type === 'enabled' ? true : thinking?.type === 'disabled' ? false : undefined,
        }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_HUNYUAN_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const functionCallKeywords = ['hunyuan-functioncall', 'hunyuan-turbo', 'hunyuan-pro'];

    const reasoningKeywords = ['hunyuan-t1'];

    const modelsPage = (await client.models.list()) as any;
    const modelList: HunyuanModelCard[] = modelsPage.data;

    return modelList
      .filter(Boolean)
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );

        return {
          contextWindowTokens: knownModel?.contextWindowTokens ?? undefined,
          displayName: knownModel?.displayName ?? undefined,
          enabled: knownModel?.enabled || false,
          functionCall:
            (functionCallKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) &&
              !model.id.toLowerCase().includes('vision')) ||
            knownModel?.abilities?.functionCall ||
            false,
          id: model.id,
          reasoning:
            reasoningKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) ||
            knownModel?.abilities?.reasoning ||
            false,
          vision:
            model.id.toLowerCase().includes('vision') || knownModel?.abilities?.vision || false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  },
  provider: ModelProvider.Hunyuan,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeHunyuanAI = createOpenAICompatibleRuntime(params);
