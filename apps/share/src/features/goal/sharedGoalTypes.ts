import type { SharedGoalView } from '@/server/routers/lambda/_helpers/sharedGoalView';

/**
 * The redacted view `goalShare.getSharedGoal` returns. Type-only, so nothing of
 * the server reaches the bundle.
 */
export type SharedGoalData = SharedGoalView & {
  /** The viewer is the share's owner, so a `private` share still opens for them. */
  isOwner: boolean;
  visibility: 'link' | 'private';
};
