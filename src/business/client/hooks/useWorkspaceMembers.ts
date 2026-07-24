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
