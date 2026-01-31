import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import { QwenAIStream } from '../../core/streams';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { createQwenImage } from './createImage';

export interface QwenModelCard {
  id: string;
}

/*
  QwenLegacyModels: A set of legacy Qwen models that do not support presence_penalty.
  Currently, presence_penalty is only supported on Qwen commercial models and open-source models starting from Qwen 1.5 and later.
*/
export const QwenLegacyModels = new Set([
  'qwen-72b-chat',
  'qwen-14b-chat',
  'qwen-7b-chat',
  'qwen-1.8b-chat',
  'qwen-1.8b-longcontext-chat',
]);

export const LobeQwenAI = createOpenAICompatibleRuntime({
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, presence_penalty, temperature, thinking, top_p, enabledSearch, ...rest } =
        payload;

      // Resolve parameters with model-specific constraints
      const resolvedParams = resolveParameters(
        { presence_penalty, temperature, top_p },
        {
          normalizeTemperature: false,
          presencePenaltyRange: QwenLegacyModels.has(model) ? undefined : { max: 2, min: -2 },
          temperatureRange: { max: 2, min: 0 },
          topPRange:
            model.startsWith('qvq') || model.startsWith('qwen-vl')
              ? { max: 1, min: 0 }
              : { max: 1, min: 0 },
        },
      );

      return {
        ...rest,
        ...(model.includes('-thinking')
          ? {
            enable_thinking: true,
            thinking_budget:
              thinking?.budget_tokens === 0 ? 0 : thinking?.budget_tokens || undefined,
          }
          : [
            'qwen3',
            'qwen-turbo',
            'qwen-plus',
            'qwen-flash',
            'deepseek-v3.1',
            'deepseek-v3.2',
            'glm',
            'kimi-k2.5',
          ].some((keyword) => model.toLowerCase().includes(keyword))
            ? {
              enable_thinking: thinking !== undefined ? thinking.type === 'enabled' : false,
              thinking_budget:
                thinking?.budget_tokens === 0 ? 0 : thinking?.budget_tokens || undefined,
            }
            : {}),
        frequency_penalty: undefined,
        model,
        presence_penalty: resolvedParams.presence_penalty,
        stream: true,
        temperature: resolvedParams.temperature,
        top_p: resolvedParams.top_p,
        ...(enabledSearch && {
          enable_search: enabledSearch,
          search_options: {
            search_strategy: process.env.QWEN_SEARCH_STRATEGY || 'standard', // standard or pro
          },
        }),
        ...(payload.tools && {
          parallel_tool_calls: true,
        }),
      } as any;
    },
    handleStream: QwenAIStream,
  },
  createImage: createQwenImage,
  debug: {
    chatCompletion: () => process.env.DEBUG_QWEN_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: QwenModelCard[] = modelsPage.data;

    return processMultiProviderModelList(modelList, 'qwen');
  },
  provider: ModelProvider.Qwen,
});
