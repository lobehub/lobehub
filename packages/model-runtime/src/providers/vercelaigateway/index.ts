import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface VercelAIGatewayModelCard {
  context_window?: number;
  created?: number | string;
  description?: string;
  id: string;
  max_tokens?: number;
  name?: string;
  pricing?: {
    input?: string | number;
    input_cache_read?: string | number;
    input_cache_write?: string | number;
    output?: string | number;
  };
  tags?: string[];
  type?: string;
}

export interface VercelAIGatewayReasoning {
  enabled?: boolean;
  max_tokens?: number;
}

export const formatPrice = (price?: string | number) => {
  if (price === undefined || price === null) return undefined;
  const n = typeof price === 'number' ? price : Number(price);
  if (Number.isNaN(n)) return undefined;
  // Convert per-token price (USD) to per million tokens
  return Number((n * 1e6).toPrecision(5));
};

export const params = {
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { reasoning_effort, thinking, reasoning: _reasoning, verbosity, ...rest } = payload;

      let reasoning: VercelAIGatewayReasoning | undefined;

      if (thinking?.type || thinking?.budget_tokens !== undefined || reasoning_effort) {
        if (thinking?.type === 'disabled') {
          reasoning = { enabled: false };
        } else if (thinking?.budget_tokens !== undefined) {
          reasoning = {
            enabled: true,
            max_tokens: thinking?.budget_tokens,
          };
        } else if (reasoning_effort) {
          reasoning = { enabled: true };
        }
      }

      const providerOptions: any = {};
      if ((verbosity || reasoning) && payload.model.includes('openai')) {
        providerOptions.openai = {
          ...(reasoning_effort && {
            reasoningEffort: reasoning_effort,
            reasoningSummary: 'auto',
          }),
          ...(verbosity && {
            textVerbosity: verbosity,
          }),
        };
      }

      return {
        ...rest,
        model: payload.model,
        ...(reasoning && { reasoning }),
        providerOptions,
      } as any;
    },
  },
  constructorOptions: {
    defaultHeaders: {
      'http-referer': 'https://lobehub.com',
      'x-title': 'LobeHub',
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_VERCELAIGATEWAY_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: VercelAIGatewayModelCard[] = modelsPage.data;

    const formattedModels = (modelList || []).map((m) => {
      const tags = Array.isArray(m.tags) ? m.tags : [];

      const inputPrice = formatPrice(m.pricing?.input);
      const outputPrice = formatPrice(m.pricing?.output);
      const cachedInputPrice = formatPrice(m.pricing?.input_cache_read);
      const writeCacheInputPrice = formatPrice(m.pricing?.input_cache_write);

      let displayName = m.name ?? m.id;
      if (inputPrice === 0 && outputPrice === 0) {
        displayName += ' (free)';
      }

      return {
        contextWindowTokens: m.context_window ?? undefined,
        created: m.created,
        description: m.description ?? '',
        displayName,
        functionCall: tags.includes('tool-use') || false,
        id: m.id,
        maxOutput: typeof m.max_tokens === 'number' ? m.max_tokens : undefined,
        pricing: {
          cachedInput: cachedInputPrice,
          input: inputPrice,
          output: outputPrice,
          writeCacheInput: writeCacheInputPrice,
        },
        reasoning: tags.includes('reasoning') || false,
        type: m.type === 'embedding' ? 'embedding' : 'chat',
        vision: tags.includes('vision') || false,
        // Merge all applicable extendParams for settings
        ...(() => {
          const extendParams: string[] = [];
          if (
            tags.includes('reasoning') &&
            m.id.includes('gpt-5') &&
            !m.id.includes('gpt-5.1') &&
            !m.id.includes('gpt-5.2')
          ) {
            extendParams.push('gpt5ReasoningEffort', 'textVerbosity');
          }
          if (tags.includes('reasoning') && m.id.includes('gpt-5.1') && !m.id.includes('gpt-5.2')) {
            extendParams.push('gpt5_1ReasoningEffort', 'textVerbosity');
          }
          if (tags.includes('reasoning') && m.id.includes('gpt-5.2')) {
            extendParams.push('gpt5_2ReasoningEffort', 'textVerbosity');
          }
          if (tags.includes('reasoning') && m.id.includes('openai') && !m.id.includes('gpt-5')) {
            extendParams.push('reasoningEffort', 'textVerbosity');
          }
          if (tags.includes('reasoning') && m.id.includes('claude')) {
            extendParams.push('enableReasoning', 'reasoningBudgetToken');
          }
          if (m.id.includes('claude') && writeCacheInputPrice && writeCacheInputPrice !== 0) {
            extendParams.push('disableContextCaching');
          }
          if (tags.includes('reasoning') && m.id.includes('gemini-2.5')) {
            extendParams.push('reasoningBudgetToken');
          }
          return extendParams.length > 0 ? { settings: { extendParams } } : {};
        })(),
      } as any;
    });

    return await processMultiProviderModelList(formattedModels, 'vercelaigateway');
  },
  provider: ModelProvider.VercelAIGateway,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeVercelAIGatewayAI = createOpenAICompatibleRuntime(params);
