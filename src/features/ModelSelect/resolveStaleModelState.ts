import { type LobeDefaultAiModelListItem } from 'model-bank';

import { type EnabledProviderWithModels } from '@/types/aiProvider';

export interface StaleModelState {
  meta?: LobeDefaultAiModelListItem;
  /**
   * `notEnabled`: the model exists in the builtin bank but is not enabled —
   * still routable server-side, so features using it keep working.
   * `removed`: the model id is unknown entirely — calls to it will fail.
   */
  status: 'notEnabled' | 'removed';
}

/**
 * A persisted `{ provider, model }` value may reference a model that is absent
 * from the enabled model list (e.g. it was delisted after the user picked it, or
 * a default points at a disabled model). Without special handling the select
 * renders the raw `provider/model` composite string.
 */
export const resolveStaleModelState = (
  value: { model: string; provider?: string } | undefined,
  enabledList: EnabledProviderWithModels[],
  builtinAiModelList: LobeDefaultAiModelListItem[],
  modelType: 'chat' | 'embedding',
): StaleModelState | undefined => {
  if (!value?.model) return;

  const isInEnabledList = enabledList.some(
    (provider) =>
      provider.id === value.provider && provider.children.some((model) => model.id === value.model),
  );
  if (isInEnabledList) return;

  const meta =
    builtinAiModelList.find(
      (m) => m.id === value.model && m.providerId === value.provider && m.type === modelType,
    ) ?? builtinAiModelList.find((m) => m.id === value.model && m.type === modelType);

  return { meta, status: meta ? 'notEnabled' : 'removed' };
};
