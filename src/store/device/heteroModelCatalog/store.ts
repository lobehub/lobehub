import type { HeterogeneousAgentModelCatalogSuccess } from '@lobechat/types';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import {
  createReplicaSlice,
  createReplicaState,
  recordLens,
  type ReplicaState,
} from '@/libs/replica';
import { heterogeneousAgentCatalogService } from '@/services/heterogeneousAgent';
import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

import { type HeteroModelCatalogParams, heteroModelCatalogResource } from './projection';

export interface HeteroModelCatalogStoreState {
  /** `heteroModelCatalogKey(params)` → last successful catalog. */
  heteroModelCatalogMap: Record<string, HeterogeneousAgentModelCatalogSuccess>;
  heteroModelCatalogReplica: ReplicaState<HeterogeneousAgentModelCatalogSuccess>;
}

export const initialHeteroModelCatalogState: HeteroModelCatalogStoreState = {
  heteroModelCatalogMap: {},
  heteroModelCatalogReplica: createReplicaState(),
};

/**
 * A failed discovery throws instead of resolving: the replica keeps the last
 * good catalog, and the error's `name` carries the code the selector words.
 */
export const fetchHeteroModelCatalog = async ({
  cwd,
  deviceId,
  provider,
  type,
}: HeteroModelCatalogParams): Promise<HeterogeneousAgentModelCatalogSuccess> => {
  const result = await heterogeneousAgentCatalogService.listModels({
    args: provider?.args,
    command: provider?.command,
    cwd,
    deviceId,
    env: provider?.env,
    type,
  });
  if (result.status === 'error') {
    const catalogError = new Error(result.error.message);
    catalogError.name = result.error.code;
    throw catalogError;
  }
  return result;
};

const createSlice = (
  set: (partial: Partial<HeteroModelCatalogStore>, replace?: false, action?: any) => void,
  get: () => HeteroModelCatalogStore,
) =>
  createReplicaSlice(heteroModelCatalogResource, {
    actionPrefix: 'heteroModelCatalog',
    fetcher: fetchHeteroModelCatalog,
    get,
    set,
    stateKey: 'heteroModelCatalogReplica',
    view: recordLens<HeteroModelCatalogStore, HeterogeneousAgentModelCatalogSuccess>(
      'heteroModelCatalogMap',
    ),
  });

export interface HeteroModelCatalogStore extends HeteroModelCatalogStoreState {
  /** @internal The replica slice; read through `useModelCatalog`. */
  slice: ReturnType<typeof createSlice>;
}

const devtools = createDevtools('heteroModelCatalog');

export const useHeteroModelCatalogStore = createWithEqualityFn<HeteroModelCatalogStore>()(
  devtools((set, get) => ({
    ...initialHeteroModelCatalogState,
    slice: createSlice(set, get),
  })),
  shallow,
);

expose('heteroModelCatalog', useHeteroModelCatalogStore);
