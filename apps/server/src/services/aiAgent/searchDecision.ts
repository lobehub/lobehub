import type { ModelSearchImplementType, SearchDecision } from 'model-bank';
import { resolveModelSearchDefaultSettings, resolveSearchDecision } from 'model-bank';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';

interface SearchModelCard {
  abilities?: { search?: boolean };
  config?: { deploymentName?: string };
  id: string;
  providerId: string;
  settings?: { searchImpl?: ModelSearchImplementType };
}

interface ResolveServerSearchDecisionInput {
  builtinModels: readonly SearchModelCard[];
  chatConfig?: {
    searchMode?: 'auto' | 'off' | 'on';
    useModelBuiltinSearch?: boolean;
  };
  hasModelAbilitiesOverride?: boolean;
  model: string;
  modelSearchAbility?: boolean;
  modelSearchImpl?: ModelSearchImplementType;
  provider: string;
  providerSearchMode?: ModelSearchImplementType;
}

/**
 * Resolves Server Agent Runtime search routing from provider-scoped metadata.
 * The returned decision is passed unchanged to both the tools engine and LLM payload.
 */
export const resolveServerSearchDecision = ({
  builtinModels,
  chatConfig,
  hasModelAbilitiesOverride,
  model,
  modelSearchAbility,
  modelSearchImpl,
  provider,
  providerSearchMode,
}: ResolveServerSearchDecisionInput): SearchDecision => {
  const builtinModel = builtinModels.find(
    (item) =>
      item.providerId === provider && (item.id === model || item.config?.deploymentName === model),
  );
  const resolvedModelSearchAbility = hasModelAbilitiesOverride
    ? modelSearchAbility
    : (modelSearchAbility ?? builtinModel?.abilities?.search);
  const explicitModelSearchImpl = modelSearchImpl ?? builtinModel?.settings?.searchImpl;
  const resolvedModelSearchImpl =
    resolvedModelSearchAbility === false
      ? undefined
      : (explicitModelSearchImpl ??
        (resolvedModelSearchAbility
          ? resolveModelSearchDefaultSettings(provider, builtinModel?.id ?? model).searchImpl
          : undefined));
  const builtinProviderSearchMode = DEFAULT_MODEL_PROVIDER_LIST.find((item) => item.id === provider)
    ?.settings.searchMode;

  return resolveSearchDecision({
    modelSearchImpl: resolvedModelSearchImpl,
    providerSearchMode: providerSearchMode ?? builtinProviderSearchMode,
    searchMode: chatConfig?.searchMode,
    useModelBuiltinSearch: chatConfig?.useModelBuiltinSearch,
  });
};
