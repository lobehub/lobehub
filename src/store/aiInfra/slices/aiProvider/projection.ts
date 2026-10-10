import type { LobeDefaultAiModelListItem } from 'model-bank';

import { defineReplica, stableQueryKey } from '@/libs/replica';
import { aiProviderService } from '@/services/aiProvider';
import type {
  AiProviderDetailItem,
  AiProviderListItem,
  AiProviderRuntimeState,
  EnabledProviderWithModels,
} from '@/types/aiProvider';

/**
 * The aiProvider reads — the provider list, one provider detail, and the
 * derived runtime state — as `@lobechat/replica` resources. Each used to be a
 * bare `useClientDataSWR`; the replica engine now owns hydration (first frame
 * from the persisted copy), scope isolation and head revalidation.
 *
 * The store keeps each value where its existing readers expect it (see the
 * lenses in `action.ts`): the flat `aiProviderList`, the `aiProviderDetailMap`
 * record, and the flat `aiProviderRuntimeConfig` / `enabled*` fields. In
 * particular `enabled*` stays a *derived projection*: it is computed from the
 * server rows plus the bundled model bank, and dozens of selectors read it
 * directly.
 */

/** The provider list is one per scope (`aiProviderList`). */
export const AI_PROVIDER_LIST_KEY = 'all';

/** The provider list of the active scope (`aiProviderList`). */
export const aiProviderListResource = defineReplica<Record<string, never>, AiProviderListItem[]>({
  fetcher: () => aiProviderService.getAiProviderList(),
  key: () => AI_PROVIDER_LIST_KEY,
  name: 'aiProviderList',
  storage: 'indexedDB',
  version: 1,
});

/**
 * One provider detail by id (`aiProviderDetailMap[id]`).
 *
 * `TFetched` allows `undefined` on purpose: the server answers `undefined` for
 * an id it no longer has, and the engine treats an `undefined` response as
 * "keep the shown value" — the same no-op the old hook's `if (!data) return`
 * performed. The slice drops a stale row for that id in `onSuccess` (see
 * `useFetchAiProviderItem`).
 *
 * Memory-only: the detail carries the provider's decrypted `keyVaults`, so it
 * must never reach IndexedDB / localStorage. The list (secret-free) is the only
 * persisted entry.
 */
export const aiProviderDetailResource = defineReplica<
  string,
  AiProviderDetailItem,
  AiProviderDetailItem | undefined
>({
  fetcher: (id) => aiProviderService.getAiProviderById(id),
  key: (id) => id,
  name: 'aiProviderDetail',
  version: 1,
});

/** Runtime-state entry identity: the login flag is the only query dimension. */
export interface AiProviderRuntimeStateParams {
  isLogin: boolean;
}

/** Entry key of one runtime-state fetch (`aiProviderRuntimeStateMap[key]`). */
export const aiProviderRuntimeStateQueryKey = (params: AiProviderRuntimeStateParams): string =>
  stableQueryKey(params);

/**
 * The derived runtime state: the server's enabled providers / models combined
 * with the bundled model bank. The fetcher lives on the slice (`action.ts`),
 * where the normalizers that do the combination already are; the extra
 * `builtinAiModelList` and per-type model lists are projected onto the store's
 * flat fields by the slice lens.
 *
 * Memory-only: `runtimeConfig` embeds the providers' decrypted `keyVaults`, so
 * this value must never be persisted.
 */
export type AiProviderRuntimeStateView = AiProviderRuntimeState & {
  builtinAiModelList: LobeDefaultAiModelListItem[];
  enabledAsrModelList?: EnabledProviderWithModels[];
  enabledChatModelList?: EnabledProviderWithModels[];
  enabledEmbeddingModelList?: EnabledProviderWithModels[];
  enabledImageModelList?: EnabledProviderWithModels[];
  enabledVideoModelList?: EnabledProviderWithModels[];
};

/** The derived runtime state per entry key (`aiProviderRuntimeStateMap[key]`). */
export const aiProviderRuntimeStateResource = defineReplica<
  AiProviderRuntimeStateParams,
  AiProviderRuntimeStateView
>({
  key: aiProviderRuntimeStateQueryKey,
  name: 'aiProviderRuntimeState',
  version: 1,
});
