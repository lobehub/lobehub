import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { CHAT_MODELS_BLOCK_LIST, createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import { processMultiProviderModelList } from '../../utils/modelParse';

const params = {
  baseURL: 'https://modelfold.ai/v1',
  chatCompletion: {
    handlePayload: (payload) =>
      ({
        ...payload,
        apiMode: 'chatCompletion',
        stream: payload.stream ?? true,
      }) as OpenAI.ChatCompletionCreateParamsStreaming,
  },
  debug: { chatCompletion: () => process.env.DEBUG_MODELFOLD_CHAT_COMPLETION === '1' },
  provider: ModelProvider.ModelFold,
} satisfies OpenAICompatibleFactoryOptions;

export class LobeModelFoldAI extends createOpenAICompatibleRuntime(params) {
  override async models() {
    const { data } = await this.client.models.list();

    const chatModels = data
      .filter(
        ({ id }) => !CHAT_MODELS_BLOCK_LIST.some((keyword) => id.toLowerCase().includes(keyword)),
      )
      .map(({ id }) => ({ id, type: 'chat' as const }));

    return processMultiProviderModelList(chatModels, ModelProvider.ModelFold);
  }
}
