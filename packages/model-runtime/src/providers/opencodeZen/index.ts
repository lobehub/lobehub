import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';

import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { detectModelProvider } from '../../utils/modelParse';
import { responsesAPIModels } from '../openai/modelId';
import {
  fetchModelsDevRoutingMetadata,
  resolveModelsDevModelList,
} from '../utils/modelsDev';
import { resolveProviderRouteModels } from '../utils/resolveProviderRouteModels';

// ============================================================================
// Constants
// ============================================================================

const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

// Anthropic SDK auto-appends /v1/messages to baseURL, so strip trailing /v1
const stripV1 = (url?: string) => url?.replace(/\/v1$/, '');

// Route families are derived from model IDs so routing stays aligned with the shared runtime.
const fallbackAnthropicModels = LOBE_DEFAULT_MODEL_LIST.map((model) => model.id).filter(
  (id) => detectModelProvider(id) === 'anthropic',
);

const fallbackGoogleModels = LOBE_DEFAULT_MODEL_LIST.map((model) => model.id).filter(
  (id) => detectModelProvider(id) === 'google',
);

const fallbackResponseModels = LOBE_DEFAULT_MODEL_LIST.map((model) => model.id).filter(
  (id) => detectModelProvider(id) === 'openai',
);

// ============================================================================
// Provider Export
// ============================================================================

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_ZEN_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.OpenCodeZen,
  models: async ({ client }) => {
    const { opencodezen } = await import('model-bank');
    return resolveModelsDevModelList({
      bankModels: opencodezen,
      client,
      modelsDevProvider: 'opencode',
      providerId: 'opencodezen',
    });
  },
  routers: async (options, runtimeContext?: { model?: string }) => {
    const baseURL = options.baseURL || ZEN_BASE_URL;
    const { available, modelIdsBySdk } = await fetchModelsDevRoutingMetadata('opencode');
    const anthropicModels = available
      ? (modelIdsBySdk['@ai-sdk/anthropic'] ?? [])
      : fallbackAnthropicModels;
    const googleModels = available
      ? (modelIdsBySdk['@ai-sdk/google'] ?? [])
      : fallbackGoogleModels;
    const responseModels = available
      ? (modelIdsBySdk['@ai-sdk/openai'] ?? [])
      : fallbackResponseModels;

    return [
      {
        apiType: 'anthropic',
        models: anthropicModels,
        options: {
          ...options,
          baseURL: stripV1(baseURL),
        },
      },
      {
        apiType: 'google',
        models: googleModels,
        options: {
          ...options,
          baseURL,
        },
      },
      {
        apiType: 'openai',
        models: responseModels,
        options: {
          ...options,
          baseURL,
          chatCompletion: {
            useResponseModels: available
              ? responseModels
              : [...Array.from(responsesAPIModels), /gpt-\d(?!\d)/, /^o\d/],
          },
        },
      },
      {
        apiType: 'deepseek',
        models: resolveProviderRouteModels(
          'deepseek',
          LOBE_DEFAULT_MODEL_LIST,
          runtimeContext?.model,
        ),
        options: {
          ...options,
          baseURL,
          sdkType: 'openai',
        },
      },
      // OpenAI-compatible fallback for all other models.
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
