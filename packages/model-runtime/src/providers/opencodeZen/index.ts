import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';

import { responsesAPIModels } from '../../const/models';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
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
