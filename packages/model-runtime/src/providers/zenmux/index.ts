import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';
import urlJoin from 'url-join';

import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { detectModelProvider, processMultiProviderModelList } from '../../utils/modelParse';

interface ZenMuxPricingEntry {
  conditions?: Record<string, unknown>;
  currency: string;
  unit: string;
  value: number;
}

export interface ZenMuxModelCard {
  capabilities?: {
    reasoning?: boolean;
  };
  context_length?: number;
  created: number;
  display_name?: string;
  id: string;
  input_modalities?: string[];
  object: string;
  output_modalities?: string[];
  owned_by: string;
  pricings?: Record<string, ZenMuxPricingEntry[]>;
  publish_time?: string;
}

/**
 * Pricing entries may be tiered by prompt-token conditions; the first `perMTokens`
 * entry is the base tier, which matches how we surface a single flat rate.
 */
const getPerMTokensPrice = (entries?: ZenMuxPricingEntry[]): number | undefined =>
  entries?.find((entry) => entry.unit === 'perMTokens')?.value;

const DEFAULT_BASE_URL = 'https://zenmux.ai';

export const params = {
  chatCompletion: {
    handlePayload: (payload) => {
      const { reasoning_effort, thinking, reasoning, ...rest } = payload;

      const finalReasoning = {
        ...reasoning,
        ...(reasoning_effort && { effort: reasoning_effort }),
        ...(thinking?.budget_tokens && { max_tokens: thinking.budget_tokens }),
        ...(thinking?.type === 'enabled' && { enabled: true }),
        ...(thinking?.type === 'disabled' && { enabled: false }),
      };

      const hasReasoning = Object.keys(finalReasoning).length > 0;

      return {
        ...rest,
        ...(hasReasoning && { reasoning: finalReasoning }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ZENMUX_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.ZenMux,
  models: async ({ client: openAIClient }) => {
    const modelsPage = (await openAIClient.models.list()) as any;
    const modelList: ZenMuxModelCard[] = modelsPage.data || [];

    // Map ZenMux's own capability metadata (input_modalities, capabilities, context_length,
    // pricings) onto the model card before the generic keyword-based inference runs, so
    // vision/reasoning stay correct for vendors the keyword heuristics don't know about —
    // otherwise native-vision models get vision=false and are forced through analyzeMedia
    const formattedModels = modelList.map((model) => {
      const { capabilities, context_length, input_modalities, pricings, publish_time } = model;

      return {
        ...model,
        contextWindowTokens: context_length,
        pricing: {
          cachedInput: getPerMTokensPrice(pricings?.input_cache_read),
          input: getPerMTokensPrice(pricings?.prompt),
          output: getPerMTokensPrice(pricings?.completion),
          writeCacheInput: getPerMTokensPrice(pricings?.input_cache_write),
        },
        reasoning: capabilities?.reasoning,
        releasedAt: publish_time,
        video: input_modalities ? input_modalities.includes('video') : undefined,
        vision: input_modalities ? input_modalities.includes('image') : undefined,
      };
    });

    return processMultiProviderModelList(formattedModels, 'zenmux');
  },
  routers: (options) => {
    const baseURL = options.baseURL || DEFAULT_BASE_URL;
    const userBaseURL = baseURL.replace(/\/v\d+[a-z]*\/?$/, '').replace(/\/api\/?$/, '');

    return [
      {
        apiType: 'anthropic',
        models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
          (id) => detectModelProvider(id) === 'anthropic',
        ),
        options: {
          ...options,
          baseURL: urlJoin(userBaseURL, '/api/anthropic'),
        },
      },
      {
        apiType: 'google',
        models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
          (id) => detectModelProvider(id) === 'google',
        ),
        options: {
          ...options,
          baseURL: urlJoin(userBaseURL, '/api/vertex-ai'),
        },
      },
      {
        apiType: 'openai',
        options: {
          ...options,
          baseURL: urlJoin(userBaseURL, '/api/v1'),
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeZenMuxAI = createRouterRuntime(params);
