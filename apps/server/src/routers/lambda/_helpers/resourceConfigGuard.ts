import type { PermissionResourceType } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  canPerformResourceAction,
  getResourceMeta,
  type ResourceMeta,
} from '@/server/services/resourcePermission';

import { getWorkspaceAgentParentGroupIds } from './workspaceAgentGuard';

interface ResourceConfigGuardCtx {
  db: LobeChatDatabase;
  grantedPermissions?: readonly string[];
  userId: string;
  workspaceId?: string | null;
}

export type ResourceConfigAccess = 'full' | 'none' | 'profile';

const ACCESS_RANK: Record<ResourceConfigAccess, number> = {
  full: 2,
  none: 0,
  profile: 1,
};

const getSingleResourceConfigAccess = async (
  ctx: ResourceConfigGuardCtx,
  resourceType: PermissionResourceType,
  resourceId: string,
  knownMeta?: ResourceMeta,
): Promise<ResourceConfigAccess> => {
  const workspaceId = ctx.workspaceId!;
  const meta = knownMeta ?? (await getResourceMeta(ctx.db, resourceType, resourceId));
  if (!meta || meta.workspaceId !== workspaceId) return 'none';

  const permissionParams = {
    db: ctx.db,
    grantedPermissions: ctx.grantedPermissions,
    meta,
    resourceId,
    resourceType,
    userId: ctx.userId,
    workspaceId,
  };

  if (await canPerformResourceAction({ ...permissionParams, action: 'edit' })) return 'full';
  if (await canPerformResourceAction({ ...permissionParams, action: 'view' })) return 'profile';
  return 'none';
};

/**
 * Full configuration is an edit-level capability. Members with only view/use
 * access still need public profile data to render shared conversations, but
 * must not receive prompts, tools, model settings, or other editable config.
 */
export const getResourceConfigAccess = async (
  ctx: ResourceConfigGuardCtx,
  resourceType: PermissionResourceType,
  resourceId: string,
  knownMeta?: ResourceMeta,
): Promise<ResourceConfigAccess> => {
  const workspaceId = ctx.workspaceId ?? undefined;
  if (!workspaceId) return 'full';

  const ownAccess = await getSingleResourceConfigAccess(
    { ...ctx, workspaceId },
    resourceType,
    resourceId,
    knownMeta,
  );
  if (resourceType !== 'agent' || ownAccess === 'none') return ownAccess;

  // A virtual member's effective config access cannot exceed any parent
  // group's access. This closes the direct agent-id path around a restricted
  // group while still allowing standalone agents to use their own ACL.
  const parentGroupIds = await getWorkspaceAgentParentGroupIds({
    agentId: resourceId,
    db: ctx.db,
    workspaceId,
  });
  if (parentGroupIds.length === 0) return ownAccess;

  const parentAccess = await Promise.all(
    parentGroupIds.map((groupId) =>
      getSingleResourceConfigAccess({ ...ctx, workspaceId }, 'agentGroup', groupId),
    ),
  );

  return [ownAccess, ...parentAccess].reduce((minimum, access) =>
    ACCESS_RANK[access] < ACCESS_RANK[minimum] ? access : minimum,
  );
};

const pick = <T extends Record<string, any>>(source: T, keys: readonly string[]): T => {
  const result: Record<string, any> = {};
  for (const key of keys) {
    if (key in source) result[key] = source[key];
  }
  return result as T;
};

const AGENT_PROFILE_KEYS = [
  'avatar',
  'backgroundColor',
  'createdAt',
  'description',
  'id',
  'isSupervisor',
  'marketIdentifier',
  'openingMessage',
  'openingQuestions',
  'slug',
  'title',
  'updatedAt',
  'userId',
  'virtual',
  'visibility',
  'workspaceId',
] as const;

/** Return only identity/display fields; deliberately use a whitelist. */
export const redactAgentConfig = <T extends Record<string, any>>(agent: T): T =>
  pick(agent, AGENT_PROFILE_KEYS);

const GROUP_PROFILE_KEYS = [
  'avatar',
  'backgroundColor',
  'clientId',
  'createdAt',
  'description',
  'groupId',
  'id',
  'marketIdentifier',
  'pinned',
  'supervisorAgentId',
  'title',
  'updatedAt',
  'userId',
  'visibility',
  'workspaceId',
] as const;

/**
 * Preserve group/member display metadata and welcome copy for chat surfaces,
 * while removing the group system prompt and every member's executable config.
 */
export const redactGroupConfig = <T extends Record<string, any>>(group: T): T => {
  const result = pick(group, GROUP_PROFILE_KEYS) as Record<string, any>;
  const config = group.config as Record<string, any> | null | undefined;

  if (config) {
    result.config = pick(config, ['openingMessage', 'openingQuestions']);
  } else if ('config' in group) {
    result.config = config;
  }

  if (Array.isArray(group.agents)) {
    result.agents = group.agents.map((agent: Record<string, any>) => redactAgentConfig(agent));
  }

  return result as T;
};
