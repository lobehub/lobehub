import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface JZSTOKENModelCard {
  id: string;
  object?: string;
  owned_by?: string;
}

export const params = {
  baseURL: 'https://jzstoken.com/api/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { apiMode: _, ...rest } = payload;
      return { ...rest, stream: true } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_JZSTOKEN_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const page = (await client.models.list()) as { data?: JZSTOKENModelCard[] };
    return processMultiProviderModelList(page.data ?? [], 'jzstoken');
  },
  provider: ModelProvider.JZSTOKEN,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeJZSTOKENAI = createOpenAICompatibleRuntime(params);
