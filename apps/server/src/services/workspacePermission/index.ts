import type { PERMISSION_ACTIONS, PermissionScope } from '@lobechat/const/rbac';
import { and, eq, isNull } from 'drizzle-orm';

import { RbacModel } from '@/database/models/rbac';
import { workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getScopePermissions } from '@/utils/rbac';

/**
 * Whether the user is the workspace's primary owner. Both the primary owner
 * and co-admins hold the same `workspace_owner` RBAC role, so permission codes
 * cannot tell them apart — governance actions that must exclude admins (e.g.
 * transferring other members' resources) check `workspaces.primaryOwnerId`.
 */
export const isWorkspacePrimaryOwner = async ({
  db,
  userId,
  workspaceId,
}: {
  db: LobeChatDatabase;
  userId: string;
  workspaceId: string;
}): Promise<boolean> => {
  const [workspace] = await db
    .select({ primaryOwnerId: workspaces.primaryOwnerId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  return workspace?.primaryOwnerId === userId;
};

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
 * Read the caller's effective workspace permission codes once. Membership and
 * permission lookup are independent, so run them in parallel to keep
 * permission-panel mutations to one database-latency wave. A non-member
 * resolves to no codes at all.
 *
 * Callers that match more than one action must resolve here first and pass the
 * result down as `grantedPermissions`, otherwise every extra action costs
 * another RBAC round trip.
 */
export const resolveWorkspaceGrantedPermissions = async ({
  db,
  requireMembership = true,
  userId,
  workspaceId,
}: {
  db: LobeChatDatabase;
  requireMembership?: boolean;
  userId: string;
  workspaceId: string;
}): Promise<string[]> => {
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

  return membership[0] ? resolvedPermissions : [];
};

/** Match one action's `:all` / `:owner` scopes against the caller's grants. */
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
  const granted = new Set(
    grantedPermissions ??
      (await resolveWorkspaceGrantedPermissions({ db, requireMembership, userId, workspaceId })),
  );

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
