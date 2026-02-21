import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import type { ChatStreamPayload } from '../../types';

export const LobePerplexityAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.perplexity.ai',
  chatCompletion: {
    handlePayload: (payload: ChatStreamPayload) => {
      const { presence_penalty, frequency_penalty, stream = true, temperature, ...res } = payload;

      // Resolve parameters with constraints
      const resolvedParams = resolveParameters(
        {
          frequency_penalty: presence_penalty !== 0 ? undefined : frequency_penalty || 1,
          presence_penalty: presence_penalty !== 0 ? presence_penalty : undefined,
          temperature,
        },
        {
          normalizeTemperature: false,
        },
      );

      // Perplexity doesn't support temperature >= 2
      const finalTemperature =
        resolvedParams.temperature !== undefined && resolvedParams.temperature >= 2
          ? undefined
          : resolvedParams.temperature;

      return {
        ...res,
        frequency_penalty: resolvedParams.frequency_penalty,
        presence_penalty: resolvedParams.presence_penalty,
        stream,
        temperature: finalTemperature,
      } as OpenAI.ChatCompletionCreateParamsStreaming;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_PERPLEXITY_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Perplexity,
});
