import type { PERMISSION_ACTIONS, PermissionScope } from '@lobechat/const/rbac';
import { and, eq, isNull } from 'drizzle-orm';

import { RbacModel } from '@/database/models/rbac';
import { workspaceMembers } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getScopePermissions } from '@/utils/rbac';

export interface WorkspaceScopedPermissionOptions {
  action: keyof typeof PERMISSION_ACTIONS;
  db: LobeChatDatabase;
  requireMembership?: boolean;
  scopes?: PermissionScope[];
  userId: string;
  workspaceId: string;
}

export interface WorkspaceScopedPermissionMatches {
  hasAllScope: boolean;
  hasOwnerScope: boolean;
}

/**
 * Resolve both resource scopes with one RBAC read. Membership and permission
 * lookup are independent, so run them in parallel to keep permission-panel
 * mutations to one database-latency wave.
 */
export const getWorkspaceScopedPermissionMatches = async ({
  action,
  db,
  grantedPermissions,
  requireMembership = true,
  userId,
  workspaceId,
}: Omit<WorkspaceScopedPermissionOptions, 'scopes'> & {
  grantedPermissions?: readonly string[];
}): Promise<WorkspaceScopedPermissionMatches> => {
  if (grantedPermissions) {
    const granted = new Set(grantedPermissions);
    return {
      hasAllScope: getScopePermissions(action, ['ALL']).some((code) => granted.has(code)),
      hasOwnerScope: getScopePermissions(action, ['OWNER']).some((code) => granted.has(code)),
    };
  }

  const membershipPromise = requireMembership
    ? db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
            isNull(workspaceMembers.deletedAt),
          ),
        )
        .limit(1)
    : Promise.resolve([{ userId }]);

  const [membership, resolvedPermissions] = await Promise.all([
    membershipPromise,
    new RbacModel(db, userId).getUserPermissions({ workspaceId }),
  ]);
  if (!membership[0]) return { hasAllScope: false, hasOwnerScope: false };

  const granted = new Set(resolvedPermissions);
  return {
    hasAllScope: getScopePermissions(action, ['ALL']).some((code) => granted.has(code)),
    hasOwnerScope: getScopePermissions(action, ['OWNER']).some((code) => granted.has(code)),
  };
};

export const hasWorkspaceScopedPermission = async ({
  action,
  db,
  requireMembership = true,
  scopes = ['ALL', 'OWNER'],
  userId,
  workspaceId,
}: WorkspaceScopedPermissionOptions): Promise<boolean> => {
  if (requireMembership) {
    const [membership] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .limit(1);

    if (!membership) return false;
  }

  const codes = getScopePermissions(action, scopes);
  return new RbacModel(db, userId).hasAnyPermission(codes, { workspaceId });
};
