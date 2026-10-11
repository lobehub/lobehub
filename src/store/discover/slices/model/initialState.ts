import type { CategoryItem } from '@lobehub/market-sdk';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { IdentifiersResponse, ModelListResponse } from '@/types/discover';

import type { ModelDetailValue } from './projection';

/**
 * Replica views of the model market reads, each beside its bookkeeping slot.
 * The views are plain records keyed by the entry key of the matching resource
 * (`projection.ts`); components read them through `modelSelectors`, never
 * through the fetch hook.
 */
export interface ModelSliceState {
  /** Category counts per query (`modelCategoriesQueryKey`). */
  modelCategoriesMap: Record<string, CategoryItem[]>;
  /** Replica bookkeeping of `modelCategoriesMap`. */
  modelCategoriesReplica: ReplicaState<CategoryItem[]>;
  /** Model detail per identifier (`modelDetailQueryKey`); `model: null` = not found. */
  modelDetailMap: Record<string, ModelDetailValue>;
  /** Replica bookkeeping of `modelDetailMap`. */
  modelDetailReplica: ReplicaState<ModelDetailValue>;
  /** Identifier index (`modelIdentifiersQueryKey`). */
  modelIdentifiersMap: Record<string, IdentifiersResponse>;
  /** Replica bookkeeping of `modelIdentifiersMap`. */
  modelIdentifiersReplica: ReplicaState<IdentifiersResponse>;
  /** Model list per query (`modelListQueryKey`). */
  modelListMap: Record<string, ModelListResponse>;
  /** Replica bookkeeping of `modelListMap`. */
  modelListReplica: ReplicaState<ModelListResponse>;
}

export const initialModelSliceState: ModelSliceState = {
  modelCategoriesMap: {},
  modelCategoriesReplica: createReplicaState(),
  modelDetailMap: {},
  modelDetailReplica: createReplicaState(),
  modelIdentifiersMap: {},
  modelIdentifiersReplica: createReplicaState(),
  modelListMap: {},
  modelListReplica: createReplicaState(),
};
