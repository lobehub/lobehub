import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { CHAT_MODELS_BLOCK_LIST, createOpenAICompatibleRuntime } from '../../core/openaiCompatible';

const params = {
  baseURL: 'https://modelfold.ai/v1',
  debug: { chatCompletion: () => process.env.DEBUG_MODELFOLD_CHAT_COMPLETION === '1' },
  provider: ModelProvider.ModelFold,
} satisfies OpenAICompatibleFactoryOptions;

export class LobeModelFoldAI extends createOpenAICompatibleRuntime(params) {
  override async models() {
    const { data } = await this.client.models.list();

    return data
      .filter(
        ({ id }) => !CHAT_MODELS_BLOCK_LIST.some((keyword) => id.toLowerCase().includes(keyword)),
      )
      .map(({ id }) => ({ id, type: 'chat' as const }));
  }
}
