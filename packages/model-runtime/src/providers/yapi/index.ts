import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface YAPIModelCard {
  id: string;
  object: string;
  owned_by: string;
}

/**
 * `openai/gpt-6-astra` rejects `max_tokens` and only accepts
 * `max_completion_tokens`. The rest of the catalog takes `max_tokens`.
 */
const usesMaxCompletionTokens = (model?: string) => !!model?.startsWith('openai/gpt-6');

export const params = {
  baseURL: 'https://api.y-api.bestvirtualgoods.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { max_tokens, stream, ...rest } = payload as any;

      return {
        ...rest,
        stream: stream ?? true,
        ...(max_tokens === undefined
          ? {}
          : usesMaxCompletionTokens(rest.model)
            ? { max_completion_tokens: max_tokens }
            : { max_tokens }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_YAPI_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: YAPIModelCard[] = modelsPage.data || [];

    return processMultiProviderModelList(modelList, 'yapi');
  },
  provider: ModelProvider.YAPI,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeYAPIAI = createOpenAICompatibleRuntime(params);
