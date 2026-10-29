import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

interface TokenLabPrice {
  input_per_1m?: string | null;
  output_per_1m?: string | null;
}

interface TokenLabCachePrice {
  cache_read_per_1m?: string | null;
  cache_write_per_1m?: string | null;
}

/**
 * One row of TokenLab's `GET /v1/models`. The gateway's own fields sit under
 * `tokenlab`; the rest is the OpenAI shape.
 */
export interface TokenLabModelCard {
  id: string;
  object?: string;
  owned_by?: string;
  tokenlab?: {
    cache_pricing?: TokenLabCachePrice;
    capabilities?: string[];
    /** `chat`, `image`, `video`, `embedding`, `tts`, ... */
    category?: string;
    lifecycle?: { stage?: string };
    max_input_tokens?: number | null;
    max_output_tokens?: number | null;
    official_cache_pricing?: TokenLabCachePrice;
    official_pricing?: TokenLabPrice;
    /** TokenLab's own price; empty when the model is sold at the official price. */
    pricing?: TokenLabPrice;
  };
}

const toNumber = (value?: string | null): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toLimit = (value?: number | null): number | undefined =>
  typeof value === 'number' && value > 0 ? value : undefined;

/**
 * A TokenLab row as a model card for `processMultiProviderModelList`.
 *
 * The window and reply limit are each model's own, from the gateway, so a
 * global table never overrides them. Abilities come from the gateway's
 * `capabilities` when it lists any; an empty list says nothing, so model-bank
 * fills those fields instead of them being written as `false`.
 */
export const fromTokenLab = (row: TokenLabModelCard) => {
  const meta = row.tokenlab ?? {};
  const capabilities = meta.capabilities ?? [];
  const known = capabilities.length > 0;

  const price =
    meta.pricing?.input_per_1m || meta.pricing?.output_per_1m
      ? meta.pricing
      : meta.official_pricing;
  const cache = meta.cache_pricing ?? meta.official_cache_pricing;

  return {
    contextWindowTokens: toLimit(meta.max_input_tokens),
    id: row.id,
    maxOutput: toLimit(meta.max_output_tokens),
    pricing: {
      cachedInput: toNumber(cache?.cache_read_per_1m),
      input: toNumber(price?.input_per_1m),
      output: toNumber(price?.output_per_1m),
      writeCacheInput: toNumber(cache?.cache_write_per_1m),
    },
    ...(known && {
      functionCall: capabilities.includes('tool-use'),
      reasoning: capabilities.includes('reasoning'),
      search: capabilities.includes('web-search'),
      video: capabilities.includes('video-input'),
      vision: capabilities.includes('vision'),
    }),
  };
};

/** Only chat models that can still be called; the list also has image, video, audio and embedding models. */
export const isUsableChatModel = (row: TokenLabModelCard): boolean => {
  if (!row?.id) return false;
  const meta = row.tokenlab;
  if (!meta) return true;
  if (meta.category && meta.category !== 'chat') return false;
  return meta.lifecycle?.stage !== 'retired';
};

export const params = {
  baseURL: 'https://api.tokenlab.sh/v1',
  constructorOptions: {
    defaultHeaders: {
      // Names the client in TokenLab's request logs; it carries no user data.
      'X-TokenLab-Client-Source': 'lobehub',
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_TOKENLAB_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const rows: TokenLabModelCard[] = modelsPage.data || [];

    const modelList = rows.filter(isUsableChatModel).map(fromTokenLab);

    return processMultiProviderModelList(modelList, 'tokenlab');
  },
  provider: ModelProvider.TokenLab,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeTokenLabAI = createOpenAICompatibleRuntime(params);
