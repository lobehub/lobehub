import { ModelProvider } from 'model-bank';

import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { processMultiProviderModelList } from '../../utils/modelParse';

const GO_BASE_URL = 'https://opencode.ai/zen/go/v1';

// MiniMax models in Go use @ai-sdk/anthropic (Anthropic Messages API format)
// Endpoint: /go/v1/messages
const minimaxModels = ['minimax-m2.5', 'minimax-m2.7'];

// Qwen models in Go use @ai-sdk/alibaba which is not in our apiTypes.
// They fall through to openai-compatible. The Gateway handles format conversion.
// All other models (GLM, Kimi, MiMo) use @ai-sdk/openai-compatible.

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
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeOpenCodeCodingPlanAI = createRouterRuntime(params);
