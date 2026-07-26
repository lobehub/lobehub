import type { ModelProviderKey } from '../../types';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const MODELS_DEV_URL = 'https://models.dev/api.json';

export interface ModelsDevReasoningOption {
  max?: number;
  min?: number;
  type: 'budget_tokens' | 'effort' | 'toggle' | string;
  values?: string[];
}

export interface ModelsDevModel {
  [key: string]: any;
  attachment?: boolean;
  cost?: {
    cache_read?: number;
    cache_write?: number;
    input?: number;
    output?: number;
  };
  family?: string;
  id: string;
  interleaved?: { field?: string } | boolean;
  limit?: { context?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
  name?: string;
  provider?: { npm?: string };
  reasoning?: boolean;
  reasoning_options?: ModelsDevReasoningOption[];
  release_date?: string;
  status?: string;
  structured_output?: boolean;
  tool_call?: boolean;
}

export interface ModelsDevRoutingMetadata {
  available: boolean;
  interleavedModelIds: Set<string>;
  modelIdsBySdk: Record<string, string[]>;
}

type ModelsDevData = Record<
  string,
  {
    models?: Record<string, ModelsDevModel>;
    npm?: string;
  }
>;

let cachedApiJson: ModelsDevData | null = null;
let fetchFailed = false;

/**
 * Fetch and cache the full models.dev catalog for the process lifetime.
 */
export const fetchModelsDevApi = async (): Promise<ModelsDevData | null> => {
  if (cachedApiJson) return cachedApiJson;
  if (fetchFailed) return null;

  try {
    const res = await fetch(MODELS_DEV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedApiJson = (await res.json()) as ModelsDevData;
    return cachedApiJson;
  } catch {
    fetchFailed = true;
    return null;
  }
};

/**
 * Return the model map for a models.dev provider key (e.g. `opencode-go`).
 */
export const fetchModelsDevProvider = async (
  modelsDevProvider: string,
): Promise<Record<string, ModelsDevModel>> => {
  const data = await fetchModelsDevApi();
  const models = data?.[modelsDevProvider]?.models;
  if (!models || typeof models !== 'object') return {};
  return models;
};

/**
 * Derive runtime routing metadata from a models.dev provider catalog.
 */
export const fetchModelsDevRoutingMetadata = async (
  modelsDevProvider: string,
): Promise<ModelsDevRoutingMetadata> => {
  const data = await fetchModelsDevApi();
  const provider = data?.[modelsDevProvider];
  const models = Object.values(provider?.models ?? {});
  const modelIdsBySdk: Record<string, string[]> = {};

  for (const model of models) {
    const sdk = model.provider?.npm ?? provider?.npm;
    if (!sdk) continue;
    modelIdsBySdk[sdk] ??= [];
    modelIdsBySdk[sdk].push(model.id);
  }

  return {
    available: models.length > 0,
    interleavedModelIds: new Set(
      models
        .filter(
          (model) =>
            model.interleaved &&
            typeof model.interleaved === 'object' &&
            Boolean(model.interleaved.field),
        )
        .map((model) => model.id),
    ),
    modelIdsBySdk,
  };
};

/**
 * Map models.dev `reasoning_options` → LobeHub `settings.extendParams`.
 */
export const mapReasoningOptionsToExtendParams = (
  id: string,
  reasoningOptions?: ModelsDevReasoningOption[] | null,
): string[] | undefined => {
  if (!reasoningOptions?.length) return undefined;

  const params: string[] = [];
  let effortValues: string[] | undefined;
  let budgetMax: number | undefined;
  let budgetMinOnly = false;
  let hasToggle = false;
  const lowerId = id.toLowerCase();

  for (const option of reasoningOptions) {
    if (option?.type === 'toggle') {
      hasToggle = true;
      continue;
    }
    if (option?.type === 'budget_tokens') {
      if (typeof option.max === 'number') budgetMax = option.max;
      else budgetMinOnly = true;
      continue;
    }
    if (option?.type === 'effort' && Array.isArray(option.values) && option.values.length > 0) {
      effortValues = option.values.map(String);
    }
  }

  if (hasToggle) params.push('enableReasoning');

  if (budgetMax !== undefined) {
    if (budgetMax <= 32_768) params.push('reasoningBudgetToken32k');
    else if (budgetMax <= 81_920) params.push('reasoningBudgetToken80k');
    else params.push('reasoningBudgetToken');
  } else if (budgetMinOnly) {
    if (!params.includes('enableReasoning')) params.push('enableReasoning');
    params.push('reasoningBudgetToken');
  }

  if (effortValues?.length) {
    const values = new Set(effortValues);

    if (values.size === 1 && values.has('max')) {
      // always-on
    } else if (
      values.has('high') &&
      values.has('max') &&
      !values.has('low') &&
      !values.has('medium') &&
      !values.has('none')
    ) {
      if (hasToggle || lowerId.includes('deepseek')) {
        const idx = params.indexOf('enableReasoning');
        if (idx >= 0) params.splice(idx, 1);
        params.push('deepseekV4ReasoningEffort');
      } else if (lowerId.includes('glm')) {
        params.push('glm5_2ReasoningEffort');
      } else {
        params.push('deepseekV4ReasoningEffort');
      }
    } else if (values.has('none') && values.has('high') && values.size === 2) {
      params.push('deepseekV4ReasoningEffort');
    } else if (
      values.has('low') &&
      values.has('medium') &&
      values.has('high') &&
      values.has('xhigh') &&
      values.has('max') &&
      !values.has('none')
    ) {
      if (lowerId.includes('claude')) params.push('enableAdaptiveThinking');
      params.push('opus47Effort');
    } else if (
      values.has('low') &&
      values.has('medium') &&
      values.has('high') &&
      values.has('max') &&
      !values.has('xhigh') &&
      !values.has('none')
    ) {
      if (lowerId.includes('claude')) params.push('enableAdaptiveThinking');
      params.push('effort');
    } else if (
      values.has('none') &&
      values.has('low') &&
      values.has('medium') &&
      values.has('high') &&
      values.has('xhigh') &&
      values.has('max')
    ) {
      params.push('gpt5_6ReasoningEffort');
    } else if (
      values.has('none') &&
      values.has('low') &&
      values.has('medium') &&
      values.has('high') &&
      values.has('xhigh') &&
      !values.has('max')
    ) {
      params.push('gpt5_2ReasoningEffort');
    } else if (
      values.has('low') &&
      values.has('medium') &&
      values.has('high') &&
      values.has('xhigh') &&
      !values.has('none') &&
      !values.has('max')
    ) {
      params.push('gpt5_2ReasoningEffort');
    } else if (
      values.has('medium') &&
      values.has('high') &&
      values.has('xhigh') &&
      !values.has('low') &&
      !values.has('none')
    ) {
      params.push('gpt5_2ProReasoningEffort');
    } else if (
      values.has('minimal') &&
      values.has('low') &&
      values.has('medium') &&
      values.has('high')
    ) {
      params.push('gpt5ReasoningEffort');
    } else if (
      values.has('none') &&
      values.has('low') &&
      values.has('medium') &&
      values.has('high') &&
      !values.has('xhigh')
    ) {
      params.push('gpt5_1ReasoningEffort');
    } else if (values.has('low') && values.has('high') && values.size === 2) {
      params.push('step3_5ReasoningEffort');
    } else if (values.has('low') || values.has('medium') || values.has('high')) {
      if (lowerId.includes('grok-4.5') || lowerId.includes('grok-4-5')) {
        params.push('grok4_5ReasoningEffort');
      } else if (lowerId.includes('grok-4.3') || lowerId.includes('grok-4-3')) {
        params.push('grok4_3ReasoningEffort');
      } else if (lowerId.includes('claude')) {
        params.push('effort');
      } else {
        params.push('reasoningEffort');
      }
    }
  }

  const seen = new Set<string>();
  const unique = params.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  return unique.length > 0 ? unique : undefined;
};

export type BankModelLike = {
  id: string;
  settings?: { extendParams?: string[]; [key: string]: any };
  [key: string]: any;
};

/**
 * Enrich a model id with models.dev fields + bank settings / extendParams.
 */
export const enrichWithModelsDev = (
  id: string,
  dev?: ModelsDevModel,
  bankSettings?: BankModelLike['settings'],
): { id: string; [key: string]: any } => {
  if (!dev) {
    return bankSettings ? { id, settings: bankSettings } : { id };
  }

  const inputModalities = dev.modalities?.input ?? [];
  const cost = dev.cost;
  const limit = dev.limit;
  const extendParams =
    mapReasoningOptionsToExtendParams(id, dev.reasoning_options) ?? bankSettings?.extendParams;

  return {
    id,
    displayName: dev.name,
    contextWindowTokens: limit?.context,
    maxOutput: limit?.output,
    releasedAt: dev.release_date,
    functionCall: dev.tool_call || undefined,
    reasoning: dev.reasoning || undefined,
    vision: inputModalities.includes('image') || undefined,
    structuredOutput: dev.structured_output || undefined,
    pricing: cost
      ? {
          input: cost.input,
          output: cost.output,
          cachedInput: cost.cache_read,
          writeCacheInput: cost.cache_write,
        }
      : undefined,
    ...(extendParams?.length
      ? {
          settings: {
            ...bankSettings,
            extendParams,
          },
        }
      : bankSettings
        ? { settings: bankSettings }
        : {}),
  };
};

export interface ResolveModelsDevModelListOptions {
  /** Static model-bank entries for this provider. */
  bankModels: BankModelLike[];
  /** OpenAI-compatible client with optional models.list(). */
  client?: { models?: { list?: () => Promise<{ data?: Array<{ id: string }> }> } };
  /** models.dev provider key, e.g. `alibaba-coding-plan-cn`. */
  modelsDevProvider: string;
  /** LobeHub provider id passed to processMultiProviderModelList. */
  providerId: ModelProviderKey;
}

/**
 * Resolve the official provider model list and enrich it with models.dev metadata.
 * The static model-bank is the only fallback when the official endpoint is unavailable;
 * models.dev never determines model availability.
 */
export const resolveModelsDevModelList = async ({
  bankModels,
  client,
  modelsDevProvider,
  providerId,
}: ResolveModelsDevModelListOptions) => {
  const modelsDev = await fetchModelsDevProvider(modelsDevProvider);
  const bankById = new Map(bankModels.map((m) => [m.id, m]));
  const bankByIdLower = new Map(bankModels.map((m) => [m.id.toLowerCase(), m]));

  const bankOf = (id: string) => bankById.get(id) ?? bankByIdLower.get(id.toLowerCase());

  const enrich = (id: string) =>
    enrichWithModelsDev(id, modelsDev[id] ?? modelsDev[id.toLowerCase()], bankOf(id)?.settings);

  // Official provider list is the source of truth for model availability.
  try {
    if (client?.models?.list) {
      const modelsPage = await client.models.list();
      const apiModels = modelsPage?.data || [];
      if (apiModels.length > 0) {
        return processMultiProviderModelList(
          apiModels.map((m) => enrich(m.id)),
          providerId,
        );
      }
    }
  } catch {
    // fall through
  }

  // Static bank controls fallback availability; models.dev only enriches its entries.
  return processMultiProviderModelList(
    bankModels.map((model) => enrich(model.id)),
    providerId,
  );
};

/** @internal test helper */
export const __resetModelsDevCacheForTests = () => {
  cachedApiJson = null;
  fetchFailed = false;
};
