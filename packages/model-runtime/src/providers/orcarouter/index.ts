import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';
import type { OrcaRouterPricingEntry } from './type';

// OrcaRouter quota → USD rate: 1 quota = $0.000002, so per 1M tokens = ratio * 2
// Source: OrcaRouter common/constants.go `QuotaPerUnit = 500 * 1000.0`
const QUOTA_USD_PER_1M = 2;

const PRICING_ENDPOINT = 'https://www.orcarouter.ai/api/pricing';

const isReasoningOnlyModel = (id: string) => {
  // Models that reject `temperature` / `top_p` — anthropic claude opus 4.x,
  // openai gpt-5 family, deepseek-reasoner.
  const lower = id.toLowerCase();
  if (lower.startsWith('anthropic/claude-opus-4')) return true;
  if (lower.startsWith('openai/gpt-5')) return true;
  if (lower.includes('deepseek-reasoner')) return true;
  return false;
};

const isNonChatModel = (entry: OrcaRouterPricingEntry) => {
  const name = entry.model_name.toLowerCase();
  const ep = new Set(entry.supported_endpoint_types ?? []);
  if (ep.has('image-generation') || ep.has('openai-video')) return true;
  const outMods = new Set(entry.output_modalities ?? []);
  if (outMods.has('image')) return true;
  if (['imagen', 'dall-e', 'gpt-image', 'grok-imagine'].some((k) => name.includes(k))) return true;
  if (
    name.includes('embedding') ||
    name.includes('tts') ||
    name.endsWith('-speech') ||
    name.includes('whisper') ||
    name.includes('transcrib') ||
    name.includes('rerank')
  ) {
    return true;
  }
  // Skip codex / gpt-5-pro variants — they live on /v1/completions or /v1/responses
  if (name.includes('codex')) return true;
  if (/openai\/gpt-5(\.\d+)?-pro/.test(name)) return true;
  if (ep.has('openai-response') && !ep.has('openai')) return true;
  return false;
};

export const params = {
  baseURL: 'https://api.orcarouter.ai/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { thinking, reasoning_effort, model, ...rest } = payload as any;

      const next: Record<string, any> = { ...rest, model };

      // OrcaRouter passes reasoning fields through to the upstream provider's
      // native protocol — Anthropic uses `thinking`, everyone else uses
      // top-level `reasoning_effort`. Avoid the OpenRouter-style nested block.
      if (model?.toLowerCase().startsWith('anthropic/')) {
        if (thinking?.type === 'enabled' && thinking?.budget_tokens) {
          next.thinking = { budget_tokens: thinking.budget_tokens, type: 'enabled' };
        }
      } else if (reasoning_effort) {
        next.reasoning_effort = reasoning_effort;
      } else if (thinking?.type === 'enabled') {
        next.reasoning_effort = 'medium';
      }

      // Reasoning-only models reject `temperature` / `top_p` / `top_k`.
      if (isReasoningOnlyModel(model ?? '')) {
        delete next.temperature;
        delete next.top_p;
        delete next.top_k;
      }

      return next as any;
    },
  },
  constructorOptions: {
    defaultHeaders: {
      'HTTP-Referer': 'https://lobehub.com',
      'X-Title': 'LobeHub',
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ORCAROUTER_CHAT_COMPLETION === '1',
  },
  models: async () => {
    let pricing: OrcaRouterPricingEntry[] = [];
    try {
      const response = await fetch(PRICING_ENDPOINT);
      if (response.ok) {
        pricing = (await response.json()) as OrcaRouterPricingEntry[];
      }
    } catch (error) {
      console.warn('Failed to fetch OrcaRouter pricing catalog:', error);
      return [];
    }

    const formatted = pricing.filter((m) => !isNonChatModel(m)).map((entry) => {
      const ratio = entry.model_ratio;
      const completionRatio = entry.completion_ratio ?? 1;
      const cacheRatio = entry.cache_ratio;
      const createCacheRatio = entry.create_cache_ratio;
      const supportedParams = new Set(entry.supported_parameters ?? []);
      const inputModalities = entry.input_modalities ?? [];

      const reasoning =
        supportedParams.has('reasoning') ||
        supportedParams.has('reasoning_effort') ||
        /reasoner|opus-4|gpt-5/.test(entry.model_name.toLowerCase());

      return {
        contextWindowTokens: entry.context_length,
        displayName: entry.model_name,
        functionCall: supportedParams.has('tools'),
        id: entry.model_name,
        maxOutput: entry.max_completion_tokens,
        pricing: {
          cachedInput:
            cacheRatio !== undefined ? Number((ratio * cacheRatio * QUOTA_USD_PER_1M).toFixed(6)) : undefined,
          input: Number((ratio * QUOTA_USD_PER_1M).toFixed(6)),
          output: Number((ratio * completionRatio * QUOTA_USD_PER_1M).toFixed(6)),
          writeCacheInput:
            createCacheRatio !== undefined
              ? Number((ratio * createCacheRatio * QUOTA_USD_PER_1M).toFixed(6))
              : undefined,
        },
        reasoning,
        vision: inputModalities.includes('image'),
      };
    });

    return processMultiProviderModelList(formatted, 'orcarouter');
  },
  provider: ModelProvider.OrcaRouter,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeOrcaRouterAI = createOpenAICompatibleRuntime(params);
