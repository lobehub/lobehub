import { ModelProvider, minimax as minimaxChatModels } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import { createMiniMaxImage } from './createImage';

export const getMinimaxMaxOutputs = (modelId: string): number | undefined => {
  const model = minimaxChatModels.find((model) => model.id === modelId);
  return model ? model.maxOutput : undefined;
};

export const LobeMinimaxAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.minimaxi.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { enabledSearch, max_tokens, temperature, tools, top_p, ...params } = payload;

      const minimaxTools = enabledSearch
        ? [
            ...(tools || []),
            {
              type: 'web_search',
            },
          ]
        : tools;

      // Resolve parameters with constraints
      const resolvedParams = resolveParameters(
        {
          max_tokens: max_tokens !== undefined ? max_tokens : getMinimaxMaxOutputs(payload.model),
          temperature,
          top_p,
        },
        {
          normalizeTemperature: true,
          topPRange: { max: 1, min: 0.01 },
        },
      );

      // Minimax doesn't support temperature <= 0
      const finalTemperature =
        resolvedParams.temperature !== undefined && resolvedParams.temperature <= 0
          ? undefined
          : resolvedParams.temperature;

      return {
        ...params,
        max_tokens: resolvedParams.max_tokens,
        temperature: finalTemperature,
        tools: minimaxTools,
        top_p: resolvedParams.top_p,
      } as any;
    },
  },
  createImage: createMiniMaxImage,
  debug: {
    chatCompletion: () => process.env.DEBUG_MINIMAX_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Minimax,
});
