import type { AiProviderModelListItem } from 'model-bank';

import { arrayEntity, defineReplica, type ReplicaEntityAdapter } from '@/libs/replica';

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
