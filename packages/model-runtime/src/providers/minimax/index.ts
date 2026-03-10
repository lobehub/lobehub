import { minimax as minimaxChatModels, ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import { getModelMaxOutputs } from '../../utils/getModelMaxOutputs';
import { createMiniMaxImage } from './createImage';

export const LobeMinimaxAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.minimaxi.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { enabledSearch, max_tokens, messages, temperature, top_p, ...params } = payload;

      // Interleaved thinking
      const processedMessages = messages.map((message: any) => {
        if (message.role === 'assistant' && message.reasoning) {
          // Only process historical reasoning content without a signature
          if (!message.reasoning.signature && message.reasoning.content) {
            const { reasoning, ...messageWithoutReasoning } = message;
            return {
              ...messageWithoutReasoning,
              reasoning_details: [
                {
                  format: 'MiniMax-response-v1',
                  id: 'reasoning-text-0',
                  index: 0,
                  text: reasoning.content,
                  type: 'reasoning.text',
                },
              ],
            };
          }

          // If there is a signature or no content, remove the reasoning field
          // eslint-disable-next-line unused-imports/no-unused-vars
          const { reasoning, ...messageWithoutReasoning } = message;
          return messageWithoutReasoning;
        }
        return message;
      });

      // Resolve parameters with constraints
      const resolvedParams = resolveParameters(
        {
          max_tokens:
            max_tokens !== undefined
              ? max_tokens
              : getModelMaxOutputs(payload.model, minimaxChatModels),
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
        messages: processedMessages,
        reasoning_split: true,
        temperature: finalTemperature,
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
