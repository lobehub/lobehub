import type { AiModelReasoningConfig, AiProviderModelListItem } from 'model-bank';

import { arrayEntity, defineReplica, identityOnlyScope, type ReplicaEntityAdapter } from '@/libs/replica';

import { modelReasoningConfigKey } from './initialState';

/**
 * The models of one provider, keyed by provider id (`aiModelListMap[providerId]`).
 *
 * Not paged: the server returns a provider's full list in one response, so each
 * provider owns a single replica entry. Keying by provider (instead of keeping
 * one flat list) is what lets the settings page paint a provider's models from
 * the persisted copy on the first frame and keep every visited provider cached.
 */
export const aiModelListResource = defineReplica<string, AiProviderModelListItem[]>({
  key: (providerId) => providerId,
  name: 'aiModelList',
  storage: 'indexedDB',
  version: 1,
});

/** Models are addressed by `id` within a provider's list. */
export const aiModelListEntity: ReplicaEntityAdapter<
  AiProviderModelListItem[],
  AiProviderModelListItem
> = arrayEntity<AiProviderModelListItem>((model) => model.id);

export interface AiModelReasoningConfigParams {
  model: string;
  provider: string;
}

/**
 * One model instance's saved reasoning defaults, wrapped so "nothing saved"
 * (`{ value: undefined }`) stays a confirmed value instead of an absent entry.
 */
export interface AiModelReasoningConfigEntry {
  value?: AiModelReasoningConfig;
}

/**
 * The user's per-model-instance reasoning defaults, one entry per
 * `${providerId}/${modelId}` (`modelReasoningConfigMap`). Persisted so the
 * effort picker paints the saved level on the first frame after a reload; the
 * payload is a handful of enum fields, but a user may touch many models, so the
 * stored rows are capped.
 *
 * Partitioned by identity only: the server keys these rows by userId +
 * providerId + modelId and shares them across workspaces (see
 * `AiModelModel.getModelReasoningConfig`). A workspace-partitioned replica would
 * hydrate another workspace's older copy after a switch and keep using it while
 * confirmation is offline or fails.
 */
export const aiModelReasoningConfigResource = defineReplica<
  AiModelReasoningConfigParams,
  AiModelReasoningConfigEntry
>({
  key: ({ model, provider }) => modelReasoningConfigKey(provider, model),
  name: 'aiModelReasoningConfig',
  persist: { maxEntries: 200 },
  scope: identityOnlyScope,
  storage: 'indexedDB',
  version: 1,
});
