import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import type { ChatStreamPayload } from '../../types';
import {
  isKimiNativeThinkingModel,
  isKimiReasoningEffortModel,
  isKimiReasoningModel,
} from '../moonshot/modelId';
import {
  fetchModelsDevRoutingMetadata,
  resolveModelsDevModelList,
} from '../utils/modelsDev';
import { resolveProviderRouteModels } from '../utils/resolveProviderRouteModels';

// ============================================================================
// Constants
// ============================================================================

const GO_BASE_URL = 'https://opencode.ai/zen/go/v1';

// Fallback: models that need Anthropic SDK (used when models.dev is unavailable)
const ANTHROPIC_MODEL_PREFIXES = ['minimax', 'qwen'];

// Fallback: models with interleaved reasoning_content (used when models.dev
// is unreachable). Mirrors the last-known state of models.dev.
const FALLBACK_INTERLEAVED_IDS: ReadonlySet<string> = new Set([
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'glm-5',
  'glm-5.1',
  'glm-5.2',
  'kimi-k2.5',
  'kimi-k2.6',
  'kimi-k2.7-code',
  'kimi-k3',
  'mimo-v2-omni',
  'mimo-v2-pro',
  'mimo-v2.5',
  'mimo-v2.5-pro',
]);

let cachedInterleavedIds: ReadonlySet<string> = FALLBACK_INTERLEAVED_IDS;

/**
 * Sync accessor for the interleaved model set. Returns the cached value
 * populated while resolving routes; before that, it uses a hardcoded snapshot
 * of models.dev's last-known state.
 */
const getInterleavedModelIds = (): ReadonlySet<string> => {
  return cachedInterleavedIds;
};

/**
 * Get anthropic models with self-contained fallback chain:
 *   1. models.dev (authoritative `provider.npm` field)
 *   2. static model-bank prefix match (used when models.dev is unreachable)
 *
 * Self-contained: does not depend on a runtime `client` object, so it's safe
 * to call from `routers` (which receives `ClientOptions` only and has no
 * `client` property during normal chat routing).
 */
const getRoutingMetadata = async () => {
  const metadata = await fetchModelsDevRoutingMetadata('opencode-go');

  if (metadata.interleavedModelIds.size > 0) {
    cachedInterleavedIds = metadata.interleavedModelIds;
  }

  if (metadata.available) return metadata;

  // Fallback: prefix-match the static model-bank list. Equivalent to the
  // pre-refactor hard-coded behavior when models.dev is unreachable.
  try {
    const { opencodecodingplan } = await import('model-bank');
    return {
      ...metadata,
      modelIdsBySdk: {
        '@ai-sdk/anthropic': opencodecodingplan
          .map((model) => model.id)
          .filter((id) => ANTHROPIC_MODEL_PREFIXES.some((prefix) => id.startsWith(prefix))),
      },
    };
  } catch {
    return metadata;
  }
};

// ============================================================================
// Reasoning Content Helpers
// ============================================================================

// Kimi dot-versioned k2 models (k2.5+) and later generations (k3+) expose
// reasoning on the OpenAI-compatible route
const isKimiThinkingToggleModel = isKimiReasoningModel;

// Models in `interleavedIds` need:
//   1. reason → reasoning_content conversion
//   2. reasoning_content forced on all assistant messages
// The set is populated from the shared models.dev routing metadata; the fallback
// is used before route resolution or when models.dev is unavailable.
// Ref: https://models.dev/api.json → opencode-go.interleaved
const isInterleavedModel = (model: string) => {
  for (const id of getInterleavedModelIds()) {
    if (model?.includes(id)) return true;
  }
  return false;
};

const hasValidReasoning = (reasoning: any) => typeof reasoning?.content === 'string';

const isEmptyContent = (content: any) =>
  content === '' || content === null || content === undefined;

// ============================================================================
// JSON Schema Sanitizer
// ============================================================================

/**
 * Recursively remove `null` values from `enum` arrays in a JSON Schema.
 * The opencode-go backend rejects nullable enums produced by Zod `.nullable()` / `.nullish()`.
 */
export const sanitizeJsonSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeJsonSchema);

  const result: any = {};
  for (const [key, value] of Object.entries(schema)) {
    // Filter null from enum arrays
    if (key === 'enum' && Array.isArray(value)) {
      const filtered = value.filter((v: any) => v !== null);
      if (filtered.length > 0) result[key] = filtered;
      continue;
    }

    // type: ['string', 'null'] → type: 'string'
    if (key === 'type' && Array.isArray(value) && value.includes('null') && value.length >= 2) {
      const nonNullTypes = value.filter((v: any) => v !== 'null' && v !== null);
      if (nonNullTypes.length === 1) result.type = nonNullTypes[0];
      else if (nonNullTypes.length > 1) result.type = nonNullTypes;
      continue;
    }

    // Recurse into nested structures
    if (key === 'properties' || key === '$defs' || key === 'definitions') {
      const nested: any = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        nested[k] = sanitizeJsonSchema(v);
      }
      result[key] = nested;
    } else if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key) && Array.isArray(value)) {
      result[key] = value.map(sanitizeJsonSchema);
    } else if (
      [
        'items',
        'additionalProperties',
        'not',
        'contains',
        'if',
        'then',
        'else',
        'unevaluatedItems',
        'unevaluatedProperties',
      ].includes(key)
    ) {
      result[key] = sanitizeJsonSchema(value);
    } else {
      result[key] = sanitizeJsonSchema(value);
    }
  }
  return result;
};

// ============================================================================
// Payload Builder
// ============================================================================

/**
 * Build OpenAI-compatible payload with reasoning_content handling.
 * Applies to models with interleaved reasoning_content and Kimi K2.x models.
 */
const buildOpenAIPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const model = payload.model;
  const isKimi = isKimiThinkingToggleModel(model);
  const interleaved = isInterleavedModel(model);

  if (!isKimi && !interleaved) return payload as any;

  // Native-thinking Kimi models (k2.7-code, k3+) cannot turn reasoning off, so a
  // saved disabled-thinking setting must be ignored: they still require
  // reasoning_content round-trip and reject a `thinking: disabled` payload.
  const nativeThinking = isKimiNativeThinkingModel(model);
  const thinkingExplicitlyDisabled =
    !nativeThinking && (payload as any).thinking?.type === 'disabled';
  const shouldForceReasoning = (interleaved || isKimi) && !thinkingExplicitlyDisabled;

  const messages = payload.messages.map((message: any) => {
    const { reasoning, ...rest } = message;
    const normalized = isKimi && isEmptyContent(message.content) ? { ...rest, content: ' ' } : rest;

    const reasoningContent =
      typeof normalized.reasoning_content === 'string'
        ? normalized.reasoning_content
        : hasValidReasoning(reasoning)
          ? reasoning.content
          : undefined;

    if (message.role === 'assistant' && shouldForceReasoning) {
      return { ...normalized, reasoning_content: reasoningContent ?? ' ' };
    }

    if (reasoningContent !== undefined) {
      return { ...normalized, reasoning_content: reasoningContent };
    }

    return normalized;
  });

  const { reasoning_effort, thinking, ...restPayload } = payload;

  // Sanitize response_format for Kimi models
  const response_format =
    isKimi &&
    restPayload.response_format &&
    'json_schema' in restPayload.response_format &&
    restPayload.response_format.json_schema?.schema
      ? {
          ...restPayload.response_format,
          json_schema: {
            ...restPayload.response_format.json_schema,
            schema: sanitizeJsonSchema(restPayload.response_format.json_schema.schema),
          },
        }
      : restPayload.response_format;

  // Sanitize tool parameters for Kimi models
  const tools =
    isKimi && restPayload.tools
      ? restPayload.tools.map((tool: any) => ({
          ...tool,
          function: {
            ...tool.function,
            parameters: tool.function?.parameters
              ? sanitizeJsonSchema(tool.function.parameters)
              : tool.function?.parameters,
          },
        }))
      : restPayload.tools;

  return {
    ...restPayload,
    messages,
    response_format,
    tools,
    // Kimi K3+ only accepts reasoning_effort 'max' (also the server default) — drop
    // any other saved effort instead of sending a value the API rejects
    ...(!thinkingExplicitlyDisabled &&
    reasoning_effort &&
    (!isKimiReasoningEffortModel(model) || reasoning_effort === 'max')
      ? { reasoning_effort }
      : {}),
    // K3+ models configure reasoning via top-level reasoning_effort only and
    // reject the K2.x-only `thinking` param; native-thinking models never get
    // `disabled` re-emitted (the toggle does not exist for them).
    ...(!isKimiReasoningEffortModel(model) &&
    (thinking?.type === 'enabled' || (thinking?.type === 'disabled' && !nativeThinking))
      ? { thinking: { type: thinking.type } }
      : {}),
    stream: payload.stream ?? true,
  } as OpenAI.ChatCompletionCreateParamsStreaming;
};

// ============================================================================
// Runtime Instances
// ============================================================================

// OpenAI-compatible runtime for non-Anthropic models
const LobeOpenCodeCodingPlanOpenAI = createOpenAICompatibleRuntime({
  provider: ModelProvider.OpenCodeCodingPlan,
  baseURL: GO_BASE_URL,
  chatCompletion: { handlePayload: buildOpenAIPayload },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
});

// Anthropic SDK auto-appends /v1/messages to baseURL, so strip trailing /v1
const stripV1 = (url?: string) => url?.replace(/\/v1$/, '');

// ============================================================================
// Provider Export
// ============================================================================

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.OpenCodeCodingPlan,
  models: async ({ client }) => {
    const { opencodecodingplan } = await import('model-bank');
    return resolveModelsDevModelList({
      bankModels: opencodecodingplan,
      client,
      modelsDevProvider: 'opencode-go',
      providerId: 'opencodecodingplan',
    });
  },
  routers: async (options, runtimeContext?: { model?: string }) => {
    const baseURL = options.baseURL || GO_BASE_URL;

    const { modelIdsBySdk } = await getRoutingMetadata();
    const anthropicModels = modelIdsBySdk['@ai-sdk/anthropic'] ?? [];
    const googleModels = modelIdsBySdk['@ai-sdk/google'] ?? [];
    const responseModels = modelIdsBySdk['@ai-sdk/openai'] ?? [];

    return [
      // Anthropic SDK for models with provider.npm === '@ai-sdk/anthropic'
      {
        apiType: 'anthropic',
        models: anthropicModels,
        options: { ...options, baseURL: stripV1(baseURL) },
      },
      {
        apiType: 'google',
        models: googleModels,
        options: { ...options, baseURL },
      },
      {
        apiType: 'openai',
        models: responseModels,
        options: {
          ...options,
          baseURL,
          chatCompletion: { useResponseModels: responseModels },
        },
      },
      // DeepSeek models via the deepseek runtime (OpenAI-compatible endpoint)
      {
        apiType: 'deepseek',
        models: resolveProviderRouteModels(
          'deepseek',
          LOBE_DEFAULT_MODEL_LIST,
          runtimeContext?.model,
        ),
        options: { ...options, baseURL, sdkType: 'openai' },
      },
      // OpenAI-compatible fallback for all other models
      {
        apiType: 'openai',
        runtime: LobeOpenCodeCodingPlanOpenAI as any,
        options: { ...options, baseURL },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeOpenCodeCodingPlanAI = createRouterRuntime(params);
