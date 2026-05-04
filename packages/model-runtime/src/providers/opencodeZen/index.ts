import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';

import { responsesAPIModels } from '../../const/models';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import type { ChatStreamPayload } from '../../types';
import { detectModelProvider, processMultiProviderModelList } from '../../utils/modelParse';

const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

// Claude models use @ai-sdk/anthropic via Zen Gateway
const claudeModels = LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
  (id) => detectModelProvider(id) === 'anthropic',
);

// GPT-5.x models use @ai-sdk/openai (Responses API) via Zen Gateway
const gptModels = LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
  (id) => detectModelProvider(id) === 'openai',
);

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
    chatCompletion: () => process.env.DEBUG_OPENCODE_ZEN_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.OpenCodeZen,
  models: async ({ client: openAIClient }) => {
    const modelsPage = (await openAIClient.models.list()) as any;
    const modelList = modelsPage.data || [];
    return processMultiProviderModelList(modelList, 'opencodezen');
  },
  routers: (options) => {
    const baseURL = options.baseURL || ZEN_BASE_URL;
    return [
      // Anthropic router for Claude models
      {
        apiType: 'anthropic',
        models: claudeModels,
        options: {
          ...options,
          baseURL: stripV1(baseURL),
        },
      },
      // OpenAI router for GPT-5.x models (Responses API)
      {
        apiType: 'openai',
        models: gptModels,
        options: {
          ...options,
          baseURL,
          chatCompletion: {
            useResponseModels: [...Array.from(responsesAPIModels), /gpt-\d(?!\d)/, /^o\d/],
          },
        },
      },
      // OpenAI-compatible fallback for all other models (Gemini, GLM, Kimi, MiniMax, Qwen, etc.)
      {
        apiType: 'openai',
        options: {
          ...options,
          baseURL,
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeOpenCodeZenAI = createRouterRuntime(params);
