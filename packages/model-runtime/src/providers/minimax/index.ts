import { minimax as minimaxChatModels, ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import { resolveSafeMaxTokens } from '../../utils/resolveSafeMaxTokens';
import { createMiniMaxImage } from './createImage';
import { createMiniMaxVideo } from './createVideo';

export const params = {
  baseURL: 'https://api.minimaxi.com/v1',
  chatCompletion: {
    handlePayload: (payload: any) => {
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

      // MiniMax API enforces `input_tokens + max_tokens <= context_window`,
      // so we must derive max_tokens dynamically from the actual input size
      // when the caller did not specify one. Estimate against the sanitized
      // messages (with stripped reasoning) — that's what we actually send.
      const safeMaxTokens = resolveSafeMaxTokens(
        { ...payload, messages: processedMessages },
        minimaxChatModels,
      );

      // Resolve parameters with constraints
      const resolvedParams = resolveParameters(
        {
          max_tokens: safeMaxTokens,
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
  createVideo: createMiniMaxVideo,
  debug: {
    chatCompletion: () => process.env.DEBUG_MINIMAX_CHAT_COMPLETION === '1',
  },
  handlePollVideoStatus: async (inferenceId: string, options: any) => {
    const { pollMiniMaxVideoStatus } = await import('./createVideo');
    return pollMiniMaxVideoStatus(inferenceId, {
      apiKey: options.apiKey,
      baseURL: options.baseURL || '',
    });
  },
  provider: ModelProvider.Minimax,
};

export const LobeMinimaxAI = createOpenAICompatibleRuntime(params);
