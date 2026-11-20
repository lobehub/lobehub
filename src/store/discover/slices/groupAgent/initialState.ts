import type { CategoryItem } from '@lobehub/market-sdk';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type {
  DiscoverGroupAgentDetail,
  GroupAgentListResponse,
  IdentifiersResponse,
} from '@/types/discover';

/**
 * Replica views of the group-agent market reads, each beside its bookkeeping
 * slot. The views are plain records keyed by the entry key of the matching
 * resource (`projection.ts`); components read them through
 * `groupAgentSelectors`, never through the fetch hook.
 */
export interface GroupAgentSliceState {
  /** Category counts per query (`groupAgentCategoriesQueryKey`). */
  groupAgentCategoriesMap: Record<string, CategoryItem[]>;
  /** Replica bookkeeping of `groupAgentCategoriesMap`. */
  groupAgentCategoriesReplica: ReplicaState<CategoryItem[]>;
  /** Group-agent detail per identifier / version (`groupAgentDetailQueryKey`). */
  groupAgentDetailMap: Record<string, DiscoverGroupAgentDetail>;
  /** Replica bookkeeping of `groupAgentDetailMap`. */
  groupAgentDetailReplica: ReplicaState<DiscoverGroupAgentDetail>;
  /** Identifier index of the market (`groupAgentIdentifiersQueryKey`). */
  groupAgentIdentifiersMap: Record<string, IdentifiersResponse>;
  /** Replica bookkeeping of `groupAgentIdentifiersMap`. */
  groupAgentIdentifiersReplica: ReplicaState<IdentifiersResponse>;
  /** Group-agent list per query (`groupAgentListQueryKey`). */
  groupAgentListMap: Record<string, GroupAgentListResponse>;
  /** Replica bookkeeping of `groupAgentListMap`. */
  groupAgentListReplica: ReplicaState<GroupAgentListResponse>;
}

export const initialGroupAgentSliceState: GroupAgentSliceState = {
  groupAgentCategoriesMap: {},
  groupAgentCategoriesReplica: createReplicaState(),
  groupAgentDetailMap: {},
  groupAgentDetailReplica: createReplicaState(),
  groupAgentIdentifiersMap: {},
  groupAgentIdentifiersReplica: createReplicaState(),
  groupAgentListMap: {},
  groupAgentListReplica: createReplicaState(),
};
