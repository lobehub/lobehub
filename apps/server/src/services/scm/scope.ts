import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Who may bind a provider installation to a workspace: every active member
 * except read-only viewers. Binding pulls the installation's repositories
 * and pull-request traffic into the whole workspace, which is a write.
 */
const INSTALLER_ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'member']);

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
