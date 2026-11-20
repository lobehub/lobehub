import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type DiscoverUserProfile } from '@/types/discover';

/**
 * Replica view of the community profile reads, beside its bookkeeping slot.
 * The view is a plain record keyed by the profile's username (`projection.ts`);
 * components read it through `userSelectors`, never through the fetch hook.
 */
export interface UserSliceState {
  /** A community user / organization profile per username (`userProfileKey`). */
  userProfileMap: Record<string, DiscoverUserProfile>;
  /** Replica bookkeeping of `userProfileMap`. */
  userProfileReplica: ReplicaState<DiscoverUserProfile>;
}

export const initialUserSliceState: UserSliceState = {
  userProfileMap: {},
  userProfileReplica: createReplicaState(),
};
