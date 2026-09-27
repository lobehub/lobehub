import { type LobeDefaultAiModelListItem } from 'model-bank';

import { type EnabledProviderWithModels } from '@/types/aiProvider';

export interface StaleModelState {
  meta?: LobeDefaultAiModelListItem;
  /**
   * `notEnabled`: the model exists in the builtin bank but is not enabled —
   * still routable server-side, so features using it keep working.
   * `redirected`: the model id is retired but mapped to a successor — requests
   * are transparently served by the successor model.
   * `removed`: the model id is unknown entirely — calls to it will fail.
   * `unsupported`: the model does not meet this picker's capability requirements.
   */
  status: 'notEnabled' | 'redirected' | 'removed' | 'unsupported';
  /** The successor model's metadata; only set for `redirected`. */
  successor?: LobeDefaultAiModelListItem;
  /** The successor model's id; only set for `redirected`. */
  successorId?: string;
}

export interface ResolveStaleModelStateContext {
  builtinAiModelList: LobeDefaultAiModelListItem[];
  enabledList: EnabledProviderWithModels[];
  modelFilter?: (model: EnabledProviderWithModels['children'][number]) => boolean;
  modelRedirects?: Record<string, string>;
  modelType: 'chat' | 'embedding';
}

/**
 * Pick the provider the "enable this model" remedy should write to.
 *
 * The persisted provider wins whenever the user actually has that provider: the
 * same model id can exist in several catalogs (e.g. a branding provider mirroring
 * openai ids), and the builtin-bank match may have resolved via the id-only
 * fallback to an unrelated provider — enabling there would leave every other
 * surface referencing `${persistedProvider}/${model}` still stale. The bank's
 * provider is only a fallback for a persisted provider that no longer exists.
 */
export const resolveEnableTargetProviderId = (
  value: { model: string; provider?: string } | undefined,
  {
    enabledAiProviders,
    enabledList,
    metaProviderId,
  }: {
    enabledAiProviders?: { id: string }[];
    enabledList: EnabledProviderWithModels[];
    metaProviderId?: string;
  },
): string | undefined => {
  const persisted = value?.provider;

  if (
    persisted &&
    (enabledList.some((provider) => provider.id === persisted) ||
      enabledAiProviders?.some((provider) => provider.id === persisted))
  )
    return persisted;

  return metaProviderId;
};

/**
 * A persisted `{ provider, model }` value may reference a model that is absent
 * from the enabled model list (e.g. it was delisted after the user picked it, or
 * a default points at a disabled model). Without special handling the select
 * renders the raw `provider/model` composite string.
 */
export const resolveStaleModelState = (
  value: { model: string; provider?: string } | undefined,
  {
    builtinAiModelList,
    enabledList,
    modelFilter,
    modelRedirects,
    modelType,
  }: ResolveStaleModelStateContext,
): StaleModelState | undefined => {
  if (!value?.model) return;

  const enabledModel = enabledList
    .find((provider) => provider.id === value.provider)
    ?.children.find((model) => model.id === value.model);
  if (enabledModel) {
    if (modelFilter && !modelFilter(enabledModel)) {
      return {
        meta: { ...enabledModel, providerId: value.provider!, type: modelType },
        status: 'unsupported',
      };
    }
    return;
  }

  const findBuiltin = (id: string, providerId?: string) =>
    builtinAiModelList.find(
      (m) =>
        m.id === id &&
        (providerId === undefined || m.providerId === providerId) &&
        m.type === modelType,
    );

  const meta = findBuiltin(value.model, value.provider) ?? findBuiltin(value.model);
  if (meta)
    return { meta, status: modelFilter && !modelFilter(meta) ? 'unsupported' : 'notEnabled' };

  // Redirect keys are provider-scoped (`${providerId}/${modelId}`) so a same-named
  // model under an unrelated provider is never treated as redirected.
  const successorId = value.provider
    ? modelRedirects?.[`${value.provider}/${value.model}`]
    : undefined;
  if (successorId) {
    const successor = findBuiltin(successorId, value.provider) ?? findBuiltin(successorId);
    if (successor && modelFilter && !modelFilter(successor)) return { status: 'unsupported' };
    return {
      status: 'redirected',
      successor,
      successorId,
    };
  }

  return { status: 'removed' };
};
