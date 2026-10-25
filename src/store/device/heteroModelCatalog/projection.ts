import { replicaKeys } from '@lobechat/replica';
import type {
  HeterogeneousAgentModelCatalogSuccess,
  HeterogeneousProviderConfig,
  ListHeterogeneousAgentModelsParams,
} from '@lobechat/types';

import { cacheScope, defineReplica } from '@/libs/replica';

/**
 * The model list an external agent CLI reports on one device — the options of
 * the chat-input model selector. Discovery spawns the CLI (local IPC) or a
 * device RPC, so it takes seconds; as a replica a reload paints the last list
 * on the first frame and the discovery only confirms it.
 *
 * Rows are partitioned by the cache scope (user + workspace) and keyed by
 * device + agent type + directory + launch config. The config only enters the
 * key as a hash: `env` may carry credentials, and params are never persisted.
 * Only a successful catalog is stored; a failed discovery leaves the last good
 * list in place.
 */
export interface HeteroModelCatalogParams {
  cwd?: string;
  /** Remote device; `undefined` discovers on this machine over Electron IPC. */
  deviceId?: string;
  provider?: HeterogeneousProviderConfig;
  type: ListHeterogeneousAgentModelsParams['type'];
}

export const fingerprintConfig = (provider: HeterogeneousProviderConfig | undefined) => {
  const serialized = JSON.stringify({
    args: provider?.args ?? [],
    env: Object.entries(provider?.env ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  });
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

/** `local` stands for this machine, like the device git keys. */
export const heteroModelCatalogKey = ({
  cwd,
  deviceId,
  provider,
  type,
}: HeteroModelCatalogParams) =>
  [type, deviceId ?? 'local', cwd ?? '', provider?.command ?? '', fingerprintConfig(provider)].join(
    '\u0000',
  );

const NAME = 'heteroAgentModelCatalog';
const VERSION = 1;

export const heteroModelCatalogResource = defineReplica<
  HeteroModelCatalogParams,
  HeterogeneousAgentModelCatalogSuccess
>({
  key: heteroModelCatalogKey,
  name: NAME,
  // A few agents × devices × directories; old ones fall out of storage, LRU.
  persist: { maxEntries: 20 },
  storage: 'indexedDB',
  // The default sync key embeds the raw params: picking a model would start
  // another discovery, and `env` values would land in an SWR cache key. Keep
  // the default shape (so `revalidate` still matches) with the hashed key only.
  syncKey: (params): readonly unknown[] =>
    replicaKeys.sync(NAME, VERSION, cacheScope.get(), heteroModelCatalogKey(params), null),
  version: VERSION,
});
