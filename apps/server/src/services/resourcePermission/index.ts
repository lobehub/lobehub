import type { PERMISSION_ACTIONS } from '@lobechat/const/rbac';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import type { PermissionResourceType, ResourceAccessLevel } from '@/database/schemas';
import { agents, chatGroups, documents, isResourceAccessLevelAllowed } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  getWorkspaceScopedPermissionMatches,
  isWorkspacePrimaryOwner,
} from '@/server/services/workspacePermission';

export interface ResourceMeta {
  userId: string;
  visibility: string | null;
  workspaceId: string | null;
}

export interface ResourcePermissionState {
  accessLevel: ResourceAccessLevel;
  canManage: boolean;
  creatorId: string;
  /** @deprecated Compatibility value returned for released clients. */
  generalAccess: 'editor' | 'viewer';
  visibility: 'private' | 'public';
}

export const buildResourcePermissionState = (params: {
  accessLevel: ResourceAccessLevel;
  canManage: boolean;
  creatorId: string;
  visibility: 'private' | 'public';
}): ResourcePermissionState => ({
  ...params,
  generalAccess: params.accessLevel === 'edit' ? 'editor' : 'viewer',
});

export type ResourceAccessAction =
  'changeVisibility' | 'delete' | 'edit' | 'manage' | 'transfer' | 'use' | 'view';

const RESOURCE_ACTIONS: Record<
  PermissionResourceType,
  {
    delete: keyof typeof PERMISSION_ACTIONS;
    edit: keyof typeof PERMISSION_ACTIONS;
    view: keyof typeof PERMISSION_ACTIONS;
  }
> = {
  agent: { delete: 'AGENT_DELETE', edit: 'AGENT_UPDATE', view: 'AGENT_READ' },
  agentGroup: { delete: 'AGENT_DELETE', edit: 'AGENT_UPDATE', view: 'AGENT_READ' },
  document: { delete: 'DOCUMENT_DELETE', edit: 'DOCUMENT_UPDATE', view: 'DOCUMENT_READ' },
};

const ACCESS_LEVEL_RANK: Record<ResourceAccessLevel, number> = {
  edit: 2,
  use: 1,
  view: 0,
};

export const isAccessLevelAllowed = (
  resourceType: PermissionResourceType,
  accessLevel: ResourceAccessLevel,
) => isResourceAccessLevelAllowed(resourceType, accessLevel);

/**
 * Fetch creator/visibility/workspace of a permission-capable resource,
 * without caller scoping. Authorization is applied by the action evaluator.
 */
export const getResourceMeta = async (
  db: LobeChatDatabase,
  resourceType: PermissionResourceType,
  resourceId: string,
): Promise<ResourceMeta | null> => {
  const table = { agent: agents, agentGroup: chatGroups, document: documents }[resourceType];

  const [row] = await db
    .select({ userId: table.userId, visibility: table.visibility, workspaceId: table.workspaceId })
    .from(table)
    .where(eq(table.id, resourceId))
    .limit(1);

  return row ?? null;
};

const getRbacAction = (
  resourceType: PermissionResourceType,
  action: ResourceAccessAction,
): keyof typeof PERMISSION_ACTIONS => {
  if (action === 'view') return RESOURCE_ACTIONS[resourceType].view;
  if (action === 'delete') return RESOURCE_ACTIONS[resourceType].delete;
  if (action === 'use') return 'AI_MODEL_INVOKE';
  return RESOURCE_ACTIONS[resourceType].edit;
};

const getRequiredAccessLevel = (action: ResourceAccessAction): ResourceAccessLevel => {
  if (action === 'edit') return 'edit';
  if (action === 'use') return 'use';
  return 'view';
};

/**
 * Merge Workspace RBAC (the capability ceiling) with one public resource's
 * Workspace access level. The creator and Workspace admins (`:all`) bypass
 * Member Permissions for public resources, but never bypass the RBAC ceiling;
 * private resources remain creator-only.
 */
export const canPerformResourceAction = async (params: {
  action: ResourceAccessAction;
  db: LobeChatDatabase;
  grantedPermissions?: readonly string[];
  meta: ResourceMeta;
  resourceId: string;
  resourceType: PermissionResourceType;
  userId: string;
  workspaceId: string;
}): Promise<boolean> => {
  const { action, db, grantedPermissions, meta, resourceId, resourceType, userId, workspaceId } =
    params;
  if (meta.workspaceId !== workspaceId) return false;

  const isCreator = meta.userId === userId;
  const isPrivate = meta.visibility === 'private';
  if (isPrivate && !isCreator) return false;

  const rbacAction = getRbacAction(resourceType, action);
  const { hasAllScope, hasOwnerScope } = await getWorkspaceScopedPermissionMatches({
    action: rbacAction,
    db,
    grantedPermissions,
    userId,
    workspaceId,
  });
  const hasCapability = hasAllScope || hasOwnerScope;
  if (!hasCapability) return false;
  if (action === 'changeVisibility') return isCreator;
  // Transfer rehomes the resource itself: allowed for the creator, or for the
  // workspace primary owner on shared resources (private ones were already
  // rejected above). Co-admins hold the same RBAC role as the primary owner
  // but must not take over other members' resources.
  if (action === 'transfer') {
    if (isCreator) return true;
    return isWorkspacePrimaryOwner({ db, userId, workspaceId });
  }
  if (action === 'manage') return isCreator || (!isPrivate && hasAllScope);
  if (action === 'delete') return isCreator || (!isPrivate && hasAllScope);

  const bypassesMemberAccessLevel = isCreator || (!isPrivate && hasAllScope);
  if (bypassesMemberAccessLevel) return true;
  if (isPrivate) return false;

  const accessLevel = await new ResourcePermissionModel(db, workspaceId).getEffectiveAccessLevel(
    resourceType,
    resourceId,
  );
  const requiredAccessLevel = getRequiredAccessLevel(action);
  return ACCESS_LEVEL_RANK[accessLevel] >= ACCESS_LEVEL_RANK[requiredAccessLevel];
};

export const assertCanPerformResourceAction = async (
  params: Omit<Parameters<typeof canPerformResourceAction>[0], 'meta'> & { meta?: ResourceMeta },
): Promise<void> => {
  const meta =
    params.meta ?? (await getResourceMeta(params.db, params.resourceType, params.resourceId));
  if (!meta || meta.workspaceId !== params.workspaceId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' });
  }

  const allowed = await canPerformResourceAction({ ...params, meta });
  if (!allowed) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `You do not have permission to ${params.action} this resource`,
    });
  }
};

export const canManageResourcePermission = async (params: {
  db: LobeChatDatabase;
  grantedPermissions?: readonly string[];
  meta: ResourceMeta;
  resourceId: string;
  resourceType: PermissionResourceType;
  userId: string;
  workspaceId: string;
}): Promise<boolean> => canPerformResourceAction({ ...params, action: 'manage' });

/** Backward-compatible helper for the first three edit call sites. */
export const assertCanEditResource = async (params: {
  db: LobeChatDatabase;
  resourceId: string;
  resourceType: PermissionResourceType;
  userId: string;
  workspaceId?: string;
}): Promise<void> => {
  if (!params.workspaceId) return;
  await assertCanPerformResourceAction({
    ...params,
    action: 'edit',
    workspaceId: params.workspaceId,
  });
};
