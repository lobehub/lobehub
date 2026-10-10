import { type RetrieveMemoryParams, type RetrieveMemoryResult } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';
import { userMemoryKeys } from '@/libs/swr/keys';
import { type LayersEnum } from '@/types/userMemory';

import { userMemoryCacheKey } from '../../utils/cacheKey';

/**
 * One query of the memory retrieve endpoint (`userMemoryService.retrieveMemory`).
 *
 * The entry key is the long-standing cache key of the query, so the replica view
 * (`memoryMap`) and the SWR key stay keyed exactly as before: any caller that
 * revalidates `userMemory:retrieve` by its root keeps working.
 */
export const userMemoryRetrieveResource = defineReplica<RetrieveMemoryParams, RetrieveMemoryResult>(
  {
    key: (params) => userMemoryCacheKey(params),
    name: 'userMemoryRetrieve',
    storage: 'indexedDB',
    // Adopt the existing SWR key so the legacy root-key revalidation still matches.
    syncKey: (params) => userMemoryKeys.retrieve(userMemoryCacheKey(params)),
    version: 1,
  },
);

export interface MemoryDetailParams {
  id: string;
  layer: LayersEnum;
}

/**
 * The flattened detail one right-hand panel reads: the base memory fields, the
 * layer's own row and the resolved source link.
 */
export type MemoryDetailDisplay = Record<string, unknown>;

/** Entry key of one memory detail: one entry per layer + id. */
export const memoryDetailKey = ({ id, layer }: MemoryDetailParams): string => `${layer}:${id}`;

/**
 * One memory detail (`userMemoryService.getMemoryDetail`).
 *
 * A detail is a single transient read behind the right panel. It stays out of
 * storage on purpose: a deleted or edited memory must never paint a stale
 * persisted copy before the network confirms it.
 */
export const userMemoryDetailResource = defineReplica<
  MemoryDetailParams,
  MemoryDetailDisplay,
  MemoryDetailDisplay | undefined
>({
  key: memoryDetailKey,
  name: 'userMemoryDetail',
  storage: 'memory',
  // Adopt the existing SWR key so `updateMemory`'s `mutate(memoryDetail(...))` still matches.
  syncKey: ({ id, layer }) => userMemoryKeys.memoryDetail(layer, id),
  version: 1,
});
