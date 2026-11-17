import { useMemo } from 'react';

import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';

// Derived from the slot rather than imported: deployments override the hook,
// and the row type follows whichever implementation is in place.
type WorkspaceMemberRow = ReturnType<typeof useWorkspaceMembers>[number];

export interface WorkspaceMemberProfile {
  avatar?: string | null;
  email?: string | null;
  /** Display name, falling back to the username and then the email's local part. */
  name: string;
  responsibilities?: string | null;
  /** Workspace role key (`owner` / `admin` / `member` / `viewer` / custom), if any. */
  role?: string | null;
  /** Workspace-scoped job title. */
  title?: string | null;
  userId: string;
  username?: string | null;
}

/**
 * Project one member of `members` into their profile card. Undefined for a
 * missing id, a removed member or someone who is not in the list.
 */
export const toWorkspaceMemberProfile = (
  members: readonly WorkspaceMemberRow[],
  userId?: string | null,
): WorkspaceMemberProfile | undefined => {
  if (!userId) return undefined;

  const member = members.find((item) => item.userId === userId && !item.deletedAt);
  if (!member) return undefined;

  const user = member.user;
  const name =
    user?.fullName?.trim() || user?.username?.trim() || user?.email?.trim().split('@')[0] || '';

  return {
    avatar: user?.avatar,
    email: user?.email,
    name,
    responsibilities: member.responsibilities?.trim() || null,
    role: member.role,
    title: member.title?.trim() || null,
    userId,
    username: user?.username,
  };
};

/**
 * A member of the active workspace, as their profile card shows them. Undefined
 * outside a workspace (personal mode and OSS have no member directory) or for a
 * user who is not an active member, so callers fall back to the bare avatar.
 */
export const useWorkspaceMemberProfile = (
  userId?: string | null,
): WorkspaceMemberProfile | undefined => {
  const members = useWorkspaceMembers();
  return useMemo(() => toWorkspaceMemberProfile(members, userId), [members, userId]);
};
