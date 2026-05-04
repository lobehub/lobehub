import { ModelProvider } from 'model-bank';

import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import type { ChatStreamPayload } from '../../types';
import { processMultiProviderModelList } from '../../utils/modelParse';

const GO_BASE_URL = 'https://opencode.ai/zen/go/v1';

// MiniMax models in Go use @ai-sdk/anthropic (Anthropic Messages API format)
// Endpoint: /go/v1/messages
const minimaxModels = ['minimax-m2.5', 'minimax-m2.7'];

// Kimi models need reasoning_content normalization for thinking mode.
// When thinking is enabled, assistant tool call messages must include reasoning_content,
// otherwise the gateway rejects with: "thinking is enabled but reasoning_content is missing"
const kimiThinkingModels = ['kimi-k2.5', 'kimi-k2.6', 'kimi-k2-thinking'];

/**
 * Normalize assistant messages for thinking models.
 * When thinking is enabled, every assistant message must carry a reasoning_content field,
 * otherwise Kimi gateway rejects the request.
 */
const normalizeMessagesForThinking = (messages: ChatStreamPayload['messages'], thinking: any) => {
  const isThinkingEnabled = thinking?.type !== 'disabled';
  if (!isThinkingEnabled) return messages;

  return messages.map((msg: any) => {
    if (msg.role !== 'assistant') return msg;
    if (msg.reasoning_content !== undefined) return msg;
    return { ...msg, reasoning_content: '' };
  });
};

// Anthropic SDK auto-appends /v1/messages to baseURL, so we need to strip trailing /v1
const stripV1 = (url?: string) => url?.replace(/\/v1$/, '');

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.OpenCodeCodingPlan,
  models: async () => {
    const { opencodecodingplan } = await import('model-bank');
    return processMultiProviderModelList(
      opencodecodingplan.map((m: { id: string }) => ({ id: m.id })),
      'opencodecodingplan',
    );
  },
  routers: (options) => {
    const baseURL = options.baseURL || GO_BASE_URL;
    return [
      // Anthropic router for MiniMax models (use Anthropic Messages API format)
      {
        apiType: 'anthropic',
        models: minimaxModels,
        options: {
          ...options,
          baseURL: stripV1(baseURL),
        },
      },
      // OpenAI-compatible fallback for all other models (GLM, Kimi, MiMo, Qwen)
      {
        apiType: 'openai',
        options: {
          ...options,
          baseURL,
          chatCompletion: {
            handlePayload: (payload: ChatStreamPayload) => {
              if (kimiThinkingModels.some((m) => payload.model.includes(m))) {
                return {
                  ...payload,
                  messages: normalizeMessagesForThinking(
                    payload.messages,
                    (payload as any).thinking,
                  ),
                };
              }
              return payload;
            },
          },
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeOpenCodeCodingPlanAI = createRouterRuntime(params);
