import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export interface TencentCloudModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.lkeap.cloud.tencent.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_TENCENT_CLOUD_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const reasoningKeywords = ['deepseek-r1'];

    const modelsPage = (await client.models.list()) as any;
    const modelList: TencentCloudModelCard[] = modelsPage.data;

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
          reasoning:
            reasoningKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) ||
            knownModel?.abilities?.reasoning ||
            false,
          vision: knownModel?.abilities?.vision || false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  },
  provider: ModelProvider.TencentCloud,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeTencentCloudAI = createOpenAICompatibleRuntime(params);
