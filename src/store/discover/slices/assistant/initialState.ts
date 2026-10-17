import type { CategoryItem } from '@lobehub/market-sdk';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type {
  AssistantListResponse,
  DiscoverAssistantDetail,
  IdentifiersResponse,
} from '@/types/discover';

/**
 * Replica views of the assistant market reads, each beside its bookkeeping
 * slot. The views are plain records keyed by the entry key of the matching
 * resource (`projection.ts`); components read them through
 * `assistantSelectors`, never through the fetch hook.
 */
export interface AssistantSliceState {
  /** Category counts per query (`assistantCategoriesQueryKey`). */
  assistantCategoriesMap: Record<string, CategoryItem[]>;
  /** Replica bookkeeping of `assistantCategoriesMap`. */
  assistantCategoriesReplica: ReplicaState<CategoryItem[]>;
  /** Assistant detail per identifier / source / version (`assistantDetailQueryKey`). */
  assistantDetailMap: Record<string, DiscoverAssistantDetail>;
  /** Replica bookkeeping of `assistantDetailMap`. */
  assistantDetailReplica: ReplicaState<DiscoverAssistantDetail>;
  /** Identifier index per source (`assistantIdentifiersQueryKey`). */
  assistantIdentifiersMap: Record<string, IdentifiersResponse>;
  /** Replica bookkeeping of `assistantIdentifiersMap`. */
  assistantIdentifiersReplica: ReplicaState<IdentifiersResponse>;
  /** Assistant list per query (`assistantListQueryKey`). */
  assistantListMap: Record<string, AssistantListResponse>;
  /** Replica bookkeeping of `assistantListMap`. */
  assistantListReplica: ReplicaState<AssistantListResponse>;
}

export const initialAssistantSliceState: AssistantSliceState = {
  assistantCategoriesMap: {},
  assistantCategoriesReplica: createReplicaState(),
  assistantDetailMap: {},
  assistantDetailReplica: createReplicaState(),
  assistantIdentifiersMap: {},
  assistantIdentifiersReplica: createReplicaState(),
  assistantListMap: {},
  assistantListReplica: createReplicaState(),
};
