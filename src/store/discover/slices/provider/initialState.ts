import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type {
  DiscoverProviderDetail,
  IdentifiersResponse,
  ProviderListResponse,
} from '@/types/discover';

/**
 * Replica views of the provider market reads, each beside its bookkeeping slot.
 * The views are plain records keyed by the entry key of the matching resource
 * (`projection.ts`); components read them through `providerSelectors`, never
 * through the fetch hook.
 */
export interface ProviderSliceState {
  /** Provider detail per identifier (`providerDetailQueryKey`). */
  providerDetailMap: Record<string, DiscoverProviderDetail>;
  /** Replica bookkeeping of `providerDetailMap`. */
  providerDetailReplica: ReplicaState<DiscoverProviderDetail>;
  /** Identifier index (`providerIdentifiersQueryKey`). */
  providerIdentifiersMap: Record<string, IdentifiersResponse>;
  /** Replica bookkeeping of `providerIdentifiersMap`. */
  providerIdentifiersReplica: ReplicaState<IdentifiersResponse>;
  /** Provider list per query (`providerListQueryKey`). */
  providerListMap: Record<string, ProviderListResponse>;
  /** Replica bookkeeping of `providerListMap`. */
  providerListReplica: ReplicaState<ProviderListResponse>;
}

export const initialProviderSliceState: ProviderSliceState = {
  providerDetailMap: {},
  providerDetailReplica: createReplicaState(),
  providerIdentifiersMap: {},
  providerIdentifiersReplica: createReplicaState(),
  providerListMap: {},
  providerListReplica: createReplicaState(),
};
