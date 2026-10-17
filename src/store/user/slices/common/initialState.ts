// Import the framework-agnostic core directly, not `@/libs/replica`: the app
// wiring pulls `@/libs/swr/useCacheScope`, which reads this very store, and the
// cycle would leave `createReplicaState` undefined while the initial state is
// built.
import { createReplicaState, type ReplicaState } from '@lobechat/replica';
import {
  type Plans,
  type ReferralStatusString,
  type UserInitializationState,
} from '@lobechat/types';

export interface CommonState {
  isFreePlan?: boolean;
  /** @deprecated Use onboarding field instead */
  isOnboard: boolean;
  isShowPWAGuide: boolean;
  isUserCanEnableTrace: boolean;
  isUserHasConversation: boolean;
  isUserStateInit: boolean;
  /** Thrown error from the user-state init fetch — lets tabs show error + Retry instead of a permanent skeleton. */
  isUserStateInitError?: unknown;
  referralStatus?: ReferralStatusString;
  subscriptionPlan?: Plans;
  /**
   * The confirmed bootstrap payload — the replica value behind the flat fields
   * above. Kept so the replica can read its own entry (and so a revalidation
   * that returns an unchanged payload skips the re-commit).
   */
  userState?: UserInitializationState;
  /** Replica bookkeeping for `userState` (see `createUserStateResource`). */
  userStateReplica: ReplicaState<UserInitializationState>;
}

export const initialCommonState: CommonState = {
  isFreePlan: true,
  isOnboard: false,
  isShowPWAGuide: false,
  isUserCanEnableTrace: false,
  isUserHasConversation: false,
  isUserStateInit: false,
  referralStatus: undefined,
  userStateReplica: createReplicaState(),
};
