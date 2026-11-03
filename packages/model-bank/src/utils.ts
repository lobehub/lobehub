import type {
  AiModelSettings,
  AiModelType,
  LobeDefaultAiModelListItem,
  ModelSearchImplementType,
} from './types';

export interface ResolveSearchDecisionInput {
  modelSearchImpl?: ModelSearchImplementType | null;
  providerSearchMode?: ModelSearchImplementType | null;
  searchMode?: 'auto' | 'off' | 'on';
  useModelBuiltinSearch?: boolean;
}

export interface SearchDecision {
  enabledSearch: boolean;
  isModelHasBuiltinSearch: boolean;
  isProviderHasBuiltinSearch: boolean;
  useApplicationBuiltinSearchTool: boolean;
  useModelSearch: boolean;
}

/**
 * Resolves the mutually exclusive search route shared by client and server runtimes.
 */
export const resolveSearchDecision = ({
  modelSearchImpl,
  providerSearchMode,
  searchMode,
  useModelBuiltinSearch,
}: ResolveSearchDecisionInput): SearchDecision => {
  const enabledSearch = searchMode !== 'off';
  const isModelHasBuiltinSearch = !!modelSearchImpl;
  const isProviderHasBuiltinSearch = !!providerSearchMode;
  const isBuiltinSearchInternal =
    modelSearchImpl === 'internal' || providerSearchMode === 'internal';
  const useModelSearch =
    enabledSearch &&
    (isBuiltinSearchInternal ||
      ((isModelHasBuiltinSearch || isProviderHasBuiltinSearch) && !!useModelBuiltinSearch));

  return {
    enabledSearch,
    isModelHasBuiltinSearch,
    isProviderHasBuiltinSearch,
    useApplicationBuiltinSearchTool: enabledSearch && !useModelSearch,
    useModelSearch,
  };
};

type ModelSearchSettings = Pick<AiModelSettings, 'searchImpl' | 'searchProvider'>;

const PROVIDER_SEARCH_DEFAULTS: Record<string, ModelSearchSettings> = {
  ai360: { searchImpl: 'params' },
  aihubmix: { searchImpl: 'params' },
  anthropic: { searchImpl: 'params' },
  baichuan: { searchImpl: 'params' },
  default: { searchImpl: 'params' },
  google: { searchImpl: 'params', searchProvider: 'google' },
  hunyuan: { searchImpl: 'params' },
  jina: { searchImpl: 'internal' },
  minimax: { searchImpl: 'params' },
  openai: { searchImpl: 'params' },
  perplexity: { searchImpl: 'internal' },
  qwen: { searchImpl: 'params' },
  spark: { searchImpl: 'params' },
  stepfun: { searchImpl: 'params' },
  vertexai: { searchImpl: 'params', searchProvider: 'google' },
  wenxin: { searchImpl: 'params' },
  xai: { searchImpl: 'params' },
  zhipu: { searchImpl: 'params' },
};

const MODEL_SEARCH_DEFAULTS: Record<string, Record<string, ModelSearchSettings>> = {
  openai: {
    'gpt-4o-mini-search-preview': { searchImpl: 'internal' },
    'gpt-4o-search-preview': { searchImpl: 'internal' },
  },
  spark: {
    'max-32k': { searchImpl: 'internal' },
  },
};

/**
 * Infers search settings for remotely discovered models that only expose abilities.search.
 */
export const resolveModelSearchDefaultSettings = (
  providerId: string | undefined,
  modelId: string,
): ModelSearchSettings =>
  (providerId && MODEL_SEARCH_DEFAULTS[providerId]?.[modelId]) ||
  (providerId && PROVIDER_SEARCH_DEFAULTS[providerId]) ||
  PROVIDER_SEARCH_DEFAULTS.default;

export const isProviderModelAvailable = (
  models: LobeDefaultAiModelListItem[],
  providerId: string,
  id: string,
  expectedType: AiModelType,
): boolean =>
  models.some(
    (model) =>
      model.providerId === providerId &&
      model.id === id &&
      model.enabled !== false &&
      model.type === expectedType,
  );
