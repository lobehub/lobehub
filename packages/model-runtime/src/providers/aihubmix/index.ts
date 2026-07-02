import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';
import urlJoin from 'url-join';

import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { detectModelProvider, processMultiProviderModelList } from '../../utils/modelParse';
import { responsesAPIModels } from '../openai/openaiModelId';
import { resolveProviderRouteModels } from '../utils/resolveProviderRouteModels';

/**
 * Response schema for GET https://aihubmix.com/api/v1/models
 * See https://docs.aihubmix.com/cn/api/Models-API
 */
export interface AiHubMixModelCard {
  /** Context window size in tokens. */
  context_length?: number;
  /** Model description (English). */
  desc?: string;
  /**
   * Comma-separated capability flags.
   * Known values: thinking | tools | function_calling | web | structured_outputs
   */
  features?: string;
  /**
   * Comma-separated input modalities.
   * Known values: text | image | audio | video | pdf
   */
  input_modalities?: string;
  /** Maximum output length in tokens. */
  max_output?: number;
  /** Unique model identifier (new endpoint uses model_id; legacy endpoint uses id). */
  model_id?: string;
  /**
   * Display name of the model.
   * Note: not present in official API response examples; kept for forward compatibility.
   */
  model_name?: string;
  /**
   * Pricing in USD per million tokens.
   * cache_write is the cache-write price (present in field docs but absent from response examples).
   */
  pricing?: {
    cache_read?: number;
    cache_write?: number;
    input?: number;
    output?: number;
  };
  /**
   * Model type.
   * Current values: llm | image_generation | video | tts | stt | embedding | rerank
   * Legacy aliases (auto-mapped by the platform): t2t→llm | t2i→image_generation | t2v→video | reranking→rerank
   */
  types?: string;
}

/**
 * Maps AiHubMix `types` field values to LobeHub AiModelType.
 * Both current identifiers and legacy aliases are included; the platform
 * auto-maps them server-side, but we handle both defensively on the client.
 * See https://docs.aihubmix.com/cn/api/Models-API
 *
 * Note: `rerank` / `reranking` are intentionally omitted — they are not part of
 * LobeHub's AiModelType and are filtered out before model list processing to
 * prevent rerank models from silently falling back to `chat` and failing at
 * inference time.
 */
const TYPE_MAP: Record<string, string> = {
  // Current type identifiers
  embedding: 'embedding',
  image_generation: 'image',
  llm: 'chat',
  stt: 'asr',
  tts: 'tts',
  video: 'video',
  // Legacy aliases (platform docs note automatic bidirectional mapping)
  t2i: 'image', // t2i ↔ image_generation
  t2t: 'chat', // t2t ↔ llm
  t2v: 'video', // t2v ↔ video
};

/**
 * AiHubMix `types` values that have no corresponding LobeHub AiModelType.
 * Models with these types are filtered out before processing to prevent them
 * from incorrectly appearing as chat models in the UI.
 */
const UNSUPPORTED_AIHUBMIX_TYPES = new Set(['rerank', 'reranking']);

/**
 * Map AiHubMix full-catalog API response fields to LobeHub model card fields.
 * The new endpoint returns its own schema (model_id, desc, types, features, etc.)
 * which must be normalized before being passed to processMultiProviderModelList.
 */
const mapAiHubMixModel = (m: any): { [key: string]: any; id: string } => {
  const id: string = m.id ?? m.model_id;

  // Parse features into a Set only when the field is present and non-empty
  const featureList =
    typeof m.features === 'string' && m.features.trim()
      ? m.features.split(',').map((s: string) => s.trim())
      : null;
  const featureSet = featureList ? new Set(featureList) : null;

  // Parse input_modalities into an array when present
  const inputModalities =
    typeof m.input_modalities === 'string'
      ? m.input_modalities.split(',').map((s: string) => s.trim())
      : null;

  // Remap pricing field names: cache_read → cachedInput, cache_write → writeCacheInput
  const rawPricing = m.pricing && typeof m.pricing === 'object' ? m.pricing : null;
  const pricing = rawPricing
    ? {
        ...(typeof rawPricing.input === 'number' && { input: rawPricing.input }),
        ...(typeof rawPricing.output === 'number' && { output: rawPricing.output }),
        ...(typeof rawPricing.cache_read === 'number' && { cachedInput: rawPricing.cache_read }),
        ...(typeof rawPricing.cache_write === 'number' && {
          writeCacheInput: rawPricing.cache_write,
        }),
      }
    : null;

  return {
    ...m,
    id,
    ...(m.desc !== undefined && { description: m.desc }),
    ...(m.model_name !== undefined && { displayName: m.model_name }),
    ...(m.context_length !== undefined && { contextWindowTokens: m.context_length }),
    ...(m.max_output !== undefined && { maxOutput: m.max_output }),
    ...(m.types !== undefined && { type: TYPE_MAP[m.types] }),
    ...(pricing !== null && { pricing }),
    // Map `features` capabilities only when the field is present; when absent,
    // processMultiProviderModelList falls back to keyword-based detection.
    // Known features values: thinking | tools | function_calling | web | structured_outputs
    // `structured_outputs` has no corresponding LobeHub model card field and is intentionally omitted.
    ...(featureSet && {
      functionCall: featureSet.has('tools') || featureSet.has('function_calling'),
      reasoning: featureSet.has('thinking'),
      search: featureSet.has('web'),
    }),
    ...(inputModalities && { vision: inputModalities.includes('image') }),
  };
};

// Default AiHubMix gateway. Users can point the provider at a custom or backup
// endpoint (e.g. a mirror domain) via the provider's "API endpoint" setting.
const DEFAULT_BASE_URL = 'https://aihubmix.com';

// Resolve the gateway for a request from the configured baseURL (default
// DEFAULT_BASE_URL), stripping a trailing version suffix (e.g. /v1) so the
// per-route suffixes below aren't doubled (…/v1/v1, …/v1/gemini).
const resolveBaseURL = (options: { baseURL?: string | null }) =>
  options.baseURL?.trim().replace(/\/v\d+[a-z]*\/?$/, '') || DEFAULT_BASE_URL;

export const params: CreateRouterRuntimeOptions = {
  debug: {
    chatCompletion: () => process.env.DEBUG_AIHUBMIX_CHAT_COMPLETION === '1',
  },
  defaultHeaders: {
    'APP-Code': 'LobeHub',
  },
  id: ModelProvider.AiHubMix,
  models: async ({ client }) => {
    const apiKey = (client as any).apiKey as string;

    // Derive the gateway root from the configured client baseURL (stripping the
    // trailing /v1 etc.), falling back to the default gateway. This way a user who
    // points AiHubMix at a custom/backup endpoint fetches the model list from it too.
    const clientBaseURL = ((client as any).baseURL as string) || urlJoin(DEFAULT_BASE_URL, '/v1');
    const rootBaseURL = clientBaseURL.replace(/\/v\d+[a-z]*\/?$/, '') || DEFAULT_BASE_URL;

    // AiHubMix exposes two model list endpoints:
    // - https://aihubmix.com/v1/models     — returns per-user-group list only (~256 models)
    // - https://aihubmix.com/api/v1/models — returns the complete model catalog (800+)
    // Use the full endpoint so users can access all available models.
    // See https://docs.aihubmix.com/cn/api/Models-API
    // 'APP-Code' is an AiHubMix-required client identifier.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(urlJoin(rootBaseURL, '/api/v1/models'), {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'APP-Code': 'LobeHub',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const json = (await response.json()) as { data?: any[] };
      const modelList = (json.data || [])
        .filter((m: any) => !UNSUPPORTED_AIHUBMIX_TYPES.has(m.types ?? ''))
        .map((m: any) => mapAiHubMixModel(m));
      return await processMultiProviderModelList(modelList, 'aihubmix');
    } finally {
      clearTimeout(timeoutId);
    }
  },
  routers: (options, runtimeContext) => [
    {
      apiType: 'anthropic',
      models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
        (id) => detectModelProvider(id) === 'anthropic',
      ),
      options: { baseURL: resolveBaseURL(options) },
    },
    {
      apiType: 'google',
      models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
        (id) => detectModelProvider(id) === 'google',
      ),
      options: { baseURL: urlJoin(resolveBaseURL(options), '/gemini') },
    },
    {
      apiType: 'xai',
      models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
        (id) => detectModelProvider(id) === 'xai',
      ),
      options: { baseURL: urlJoin(resolveBaseURL(options), '/v1') },
    },
    {
      apiType: 'deepseek',
      // Match the whole DeepSeek family (deepseek-v4*, deepseek-chat, ...), not
      // just the two legacy ids — the deepseek runtime simulates structured
      // output via tool calling, while the generic openai fallback sends
      // response_format json_schema which DeepSeek upstreams reject.
      models: resolveProviderRouteModels(
        'deepseek',
        LOBE_DEFAULT_MODEL_LIST,
        runtimeContext?.model,
      ),
      options: { baseURL: urlJoin(resolveBaseURL(options), '/v1') },
    },
    {
      apiType: 'openai',
      options: {
        baseURL: urlJoin(resolveBaseURL(options), '/v1'),
        chatCompletion: {
          useResponseModels: [...Array.from(responsesAPIModels), /gpt-\d(?!\d)/, /^o\d/],
        },
      },
    },
  ],
};

export const LobeAiHubMixAI = createRouterRuntime(params);
