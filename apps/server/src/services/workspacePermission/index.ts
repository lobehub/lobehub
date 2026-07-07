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
