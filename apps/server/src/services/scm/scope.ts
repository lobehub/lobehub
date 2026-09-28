import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Who may write into a workspace through the SCM loop: every active member
 * except read-only viewers. Binding an installation pulls its repositories
 * into the whole workspace, and a merge that accepts an acceptance or a
 * wake that starts a run mutates it — all writes.
 */
export const SCM_WRITE_ROLES = ['owner', 'admin', 'member'] as const;

const INSTALLER_ROLES: ReadonlySet<string> = new Set(SCM_WRITE_ROLES);

export const canManageWorkspaceScm = (role: string | null | undefined): boolean =>
  !!role && INSTALLER_ROLES.has(role);

/** `true` for a personal scope, or a workspace the user may install into. */
export const canWriteScmScope = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | null | undefined,
): Promise<boolean> => {
  if (!workspaceId) return true;
  const member = await new WorkspaceMemberModel(db, userId).getMember(workspaceId, userId);
  return canManageWorkspaceScm(member?.role);
};

/**
 * Only same-origin destinations survive: a path with a single leading slash.
 * `new URL(value, origin)` would keep an absolute or protocol-relative URL
 * intact, which would turn the install callback into an open redirect.
 */
export const sanitizeReturnTo = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined;
  return value;
};
