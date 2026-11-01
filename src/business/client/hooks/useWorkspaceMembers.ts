import type { WorkspaceMemberItem } from '@lobechat/database/schemas';

export interface WorkspaceMemberUserProfile {
  avatar?: string | null;
  email?: string | null;
  fullName?: string | null;
  username?: string | null;
}

/**
 * Membership row enriched with the member's display profile. The OSS build
 * has no workspace membership, so the stub returns an empty list; cloud
 * overrides this hook with the real workspace store data.
 */
export type WorkspaceMemberWithProfile = WorkspaceMemberItem & {
  user?: WorkspaceMemberUserProfile | null;
};

export const useWorkspaceMembers = (): WorkspaceMemberWithProfile[] => [];

/**
 * Non-hook snapshot of the same list, for imperative callers such as tool
 * executors. Empty in OSS; cloud reads the workspace store.
 */
export const getWorkspaceMembers = (): WorkspaceMemberWithProfile[] => [];
