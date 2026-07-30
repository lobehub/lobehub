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
   */
  status: 'notEnabled' | 'redirected' | 'removed';
  /** The successor model's metadata; only set for `redirected`. */
  successor?: LobeDefaultAiModelListItem;
  /** The successor model's id; only set for `redirected`. */
  successorId?: string;
}

export interface ResolveStaleModelStateContext {
  builtinAiModelList: LobeDefaultAiModelListItem[];
  enabledList: EnabledProviderWithModels[];
  modelRedirects?: Record<string, string>;
  modelType: 'chat' | 'embedding';
}

/**
 * A persisted `{ provider, model }` value may reference a model that is absent
 * from the enabled model list (e.g. it was delisted after the user picked it, or
 * a default points at a disabled model). Without special handling the select
 * renders the raw `provider/model` composite string.
 */
export const resolveStaleModelState = (
  value: { model: string; provider?: string } | undefined,
  { builtinAiModelList, enabledList, modelRedirects, modelType }: ResolveStaleModelStateContext,
): StaleModelState | undefined => {
  if (!value?.model) return;

  const isInEnabledList = enabledList.some(
    (provider) =>
      provider.id === value.provider && provider.children.some((model) => model.id === value.model),
  );
  if (isInEnabledList) return;

  const findBuiltin = (id: string, providerId?: string) =>
    builtinAiModelList.find(
      (m) =>
        m.id === id &&
        (providerId === undefined || m.providerId === providerId) &&
        m.type === modelType,
    );

  const meta = findBuiltin(value.model, value.provider) ?? findBuiltin(value.model);
  if (meta) return { meta, status: 'notEnabled' };

  const successorId = modelRedirects?.[value.model];
  if (successorId) {
    return {
      status: 'redirected',
      successor: findBuiltin(successorId, value.provider) ?? findBuiltin(successorId),
      successorId,
    };
  }

  return { status: 'removed' };
};
