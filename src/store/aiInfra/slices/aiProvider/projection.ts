import type { ReplicaStorage } from 'local-replica';
import type { LobeDefaultAiModelListItem } from 'model-bank';

import { AppIndexedDBStorage, defineReplica, stableQueryKey } from '@/libs/replica';
import { aiProviderService } from '@/services/aiProvider';
import type {
  AiProviderDetailItem,
  AiProviderListItem,
  AiProviderRuntimeState,
  EnabledProviderWithModels,
} from '@/types/aiProvider';

/**
 * The aiProvider reads — the provider list, one provider detail, and the
 * derived runtime state — as `local-replica` resources. Each used to be a
 * bare `useClientDataSWR`; the replica engine now owns hydration, scope
 * isolation and head revalidation.
 *
 * The store keeps each value where its existing readers expect it (see the
 * lenses in `action.ts`): the flat `aiProviderList`, the `aiProviderDetailMap`
 * record, and the flat `aiProviderRuntimeConfig` / `enabled*` fields. In
 * particular `enabled*` stays a *derived projection*: it is computed from the
 * server rows plus the bundled model bank, and dozens of selectors read it
 * directly.
 *
 * Persistence policy: the provider list — which the server projects without
 * any credentials — is stored as is. The detail carries the provider's
 * decrypted `keyVaults`, so it passes `storage: 'memory'` explicitly. The
 * runtime state stores only an allowlisted, secret-free display projection
 * (see `aiProviderRuntimeStateResource`). Omitting `storage` is NOT
 * memory-only: `@/libs/replica`'s `defineReplica` defaults it to `'indexedDB'`.
 */

/** The provider list is one per scope (`aiProviderList`). */
export const AI_PROVIDER_LIST_KEY = 'all';

/** The provider list of the active scope (`aiProviderList`). Secret-free. */
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
 * performed. The slice drops a stale entry for that id in `onSuccess` (see
 * `useFetchAiProviderItem`).
 *
 * Memory-only (`storage: 'memory'`): the detail carries the provider's
 * decrypted `keyVaults`, so it must never reach IndexedDB / localStorage.
 */
export const aiProviderDetailResource = defineReplica<
  string,
  AiProviderDetailItem,
  AiProviderDetailItem | undefined
>({
  fetcher: (id) => aiProviderService.getAiProviderById(id),
  key: (id) => id,
  name: 'aiProviderDetail',
  storage: 'memory',
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
 */
export type AiProviderRuntimeStateView = AiProviderRuntimeState & {
  builtinAiModelList: LobeDefaultAiModelListItem[];
  enabledAsrModelList?: EnabledProviderWithModels[];
  enabledChatModelList?: EnabledProviderWithModels[];
  enabledEmbeddingModelList?: EnabledProviderWithModels[];
  enabledImageModelList?: EnabledProviderWithModels[];
  enabledVideoModelList?: EnabledProviderWithModels[];
  isDisplaySnapshot?: true;
};

const RUNTIME_STATE_DISPLAY_FIELDS = [
  'enabledAiModels',
  'enabledAiProviders',
  'enabledAsrModelList',
  'enabledChatAiProviders',
  'enabledChatModelList',
  'enabledEmbeddingModelList',
  'enabledImageAiProviders',
  'enabledImageModelList',
  'enabledVideoAiProviders',
  'enabledVideoModelList',
  'modelRedirects',
  'providerBindingAgentTypes',
] as const satisfies readonly (keyof AiProviderRuntimeStateView)[];

/**
 * `runtimeConfig` embeds the providers' decrypted `keyVaults`, so a persisted
 * runtime state keeps only the allowlisted display fields. The result is
 * flagged `isDisplaySnapshot`: the lens paints the model lists from it but does
 * not mark the runtime state ready, so nothing sends a request with the empty
 * `runtimeConfig` before the server answers.
 */
export const toRuntimeStateDisplaySnapshot = (
  data: AiProviderRuntimeStateView,
): AiProviderRuntimeStateView => {
  const snapshot: Record<string, unknown> = {};
  for (const field of RUNTIME_STATE_DISPLAY_FIELDS) {
    if (data[field] !== undefined) snapshot[field] = data[field];
  }

  return {
    enabledAiModels: [],
    enabledAiProviders: [],
    enabledChatAiProviders: [],
    enabledImageAiProviders: [],
    enabledVideoAiProviders: [],
    ...snapshot,
    builtinAiModelList: [],
    isDisplaySnapshot: true,
    runtimeConfig: {},
  };
};

const createRuntimeStateStorage = (): ReplicaStorage<AiProviderRuntimeStateView> => {
  const storage = new AppIndexedDBStorage<AiProviderRuntimeStateView>({
    namespace: 'replica:aiProviderRuntimeState:v2',
  });
  const read = async (
    row: Promise<{ data: AiProviderRuntimeStateView; updatedAt: number } | undefined>,
  ) => {
    const value = await row;
    return value && { ...value, data: toRuntimeStateDisplaySnapshot(value.data) };
  };

  return {
    get: (key) => read(storage.get(key)),
    getStrict: (key) => read(storage.getStrict(key)),
    remove: (key) => storage.remove(key),
    set: (key, row) => storage.set(key, { ...row, data: toRuntimeStateDisplaySnapshot(row.data) }),
  };
};

/** The derived runtime state per entry key (`aiProviderRuntimeStateMap[key]`). */
export const aiProviderRuntimeStateResource = defineReplica<
  AiProviderRuntimeStateParams,
  AiProviderRuntimeStateView
>({
  key: aiProviderRuntimeStateQueryKey,
  name: 'aiProviderRuntimeState',
  storage: createRuntimeStateStorage(),
  version: 2,
});
