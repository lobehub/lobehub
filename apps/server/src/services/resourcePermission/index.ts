import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { PERMISSION_ACTIONS } from '@lobechat/const/rbac';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import type { PermissionResourceType, ResourceAccessLevel } from '@/database/schemas';
import {
  agents,
  chatGroups,
  chatGroupsAgents,
  documents,
  isResourceAccessLevelAllowed,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  getWorkspaceScopedPermissionMatches,
  isWorkspacePrimaryOwner,
  resolveWorkspaceGrantedPermissions,
} from '@/server/services/workspacePermission';

export interface ResourceMeta {
  /** Only agents carry a slug; with `virtual` it identifies a provisioned builtin. */
  slug?: string | null;
  userId: string;
  /**
   * Only agents carry this. Builtin provisioning always writes `virtual: true`
   * (`AgentModel.getBuiltinAgent`), while ordinary agents default to `false`, so
   * it is the durable marker that separates provisioned infrastructure from a row
   * that merely holds a reserved slug.
   */
  virtual?: boolean | null;
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
  // `slug` only exists on `agents`, and only there does it carry authorization
  // meaning (collaborative builtin agents — see `isCollaborativeBuiltinAgent`).
  if (resourceType === 'agent') {
    const [row] = await db
      .select({
        slug: agents.slug,
        userId: agents.userId,
        virtual: agents.virtual,
        visibility: agents.visibility,
        workspaceId: agents.workspaceId,
      })
      .from(agents)
      .where(eq(agents.id, resourceId))
      .limit(1);

    return row ?? null;
  }

  const table = { agentGroup: chatGroups, document: documents }[resourceType];

  const [row] = await db
    .select({ userId: table.userId, visibility: table.visibility, workspaceId: table.workspaceId })
    .from(table)
    .where(eq(table.id, resourceId))
    .limit(1);

  return row ?? null;
};

/**
 * Resolve the builtin markers for callers that hand-build `ResourceMeta` instead
 * of going through `getResourceMeta` (the agent-run path does, to reuse a config
 * it already loaded). Without this, missing markers silently downgrade a builtin
 * to an ordinary agent, so execution would classify a member differently from
 * configuration. Values the caller stated — including `null` / `false` — are real
 * and never re-fetched.
 */
const resolveAgentBuiltinMarkers = async (
  db: LobeChatDatabase,
  resourceId: string,
): Promise<{ slug: string | null; virtual: boolean | null }> => {
  const [row] = await db
    .select({ slug: agents.slug, virtual: agents.virtual })
    .from(agents)
    .where(eq(agents.id, resourceId))
    .limit(1);

  return { slug: row?.slug ?? null, virtual: row?.virtual ?? null };
};

/**
 * The builtin agents a workspace *collaborates on* — the ones members open and
 * configure from the UI (Lobe AI, the Agent / Group Agent builders, the page
 * agent's Copilot panel).
 *
 * Deliberately NOT the whole of `BUILTIN_AGENT_SLUGS`: the internal automation
 * agents (`nightly-review`, `self-reflection`, `self-feedback-intent`,
 * `skill-management`, `verify-agent`, `task-agent`, the onboarding agents, the
 * group supervisor) have no configuration surface, and letting any member
 * repoint their persisted model / chatConfig would silently change background
 * automation for the entire workspace. They keep the ordinary creator + General
 * access rules, which still allow every member to *use* them (the resource
 * default is `use`).
 */
const COLLABORATIVE_BUILTIN_AGENT_SLUGS: ReadonlySet<string> = new Set<string>([
  BUILTIN_AGENT_SLUGS.agentBuilder,
  BUILTIN_AGENT_SLUGS.groupAgentBuilder,
  BUILTIN_AGENT_SLUGS.inbox,
  BUILTIN_AGENT_SLUGS.pageAgent,
]);

/**
 * Whether the resource is a workspace-level builtin agent that members are meant
 * to configure together.
 *
 * These rows are shared workspace infrastructure, not authored content: they are
 * created lazily by whichever member happens to trigger them first, so
 * `agents.user_id` records an accident of timing rather than authorship, and no
 * `resource_permissions` row is ever written for them (their effective General
 * access falls back to the `use` default). Treating them as creator-owned locks
 * every other member out of the Agent Builder, of Lobe AI's config page, and of
 * the Page Copilot's own settings (LOBE-12374), so they are governed by workspace
 * capability instead: anyone holding `agent:update:{owner,all}` may
 * read/use/configure them, while destructive and ownership actions (delete /
 * transfer / visibility) stay with the creator and the workspace primary owner.
 */
/**
 * Whether the agent belongs to a chat group.
 *
 * Provisioned builtins never do — `getBuiltinAgent` creates a standalone row, and
 * a group's supervisor slug is injected read-side only, never persisted. Group
 * members, on the other hand, are created from caller-supplied payloads that were
 * historically allowed to carry `virtual: true` and (before `stripReservedSlug`) a
 * reserved slug. Excluding them is what keeps a legacy collision from inheriting
 * the shared-infrastructure bypass, without a schema change or a data migration.
 */
const isGroupMemberAgent = async (db: LobeChatDatabase, resourceId: string): Promise<boolean> => {
  const [row] = await db
    .select({ agentId: chatGroupsAgents.agentId })
    .from(chatGroupsAgents)
    .where(eq(chatGroupsAgents.agentId, resourceId))
    .limit(1);

  return !!row;
};

const isCollaborativeBuiltinAgent = (
  resourceType: PermissionResourceType,
  meta: ResourceMeta,
): boolean =>
  resourceType === 'agent' &&
  !!meta.workspaceId &&
  // `virtual` is what provisioning writes; a legacy row that merely holds a
  // reserved slug (the passthrough config endpoint used to allow that) stays an
  // ordinary agent, so no migration is needed to keep it out of the bypass.
  meta.virtual === true &&
  !!meta.slug &&
  COLLABORATIVE_BUILTIN_AGENT_SLUGS.has(meta.slug);

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
 * Workspace access level. The creator and Workspace admins (resource
 * `UPDATE:all`) bypass Member Permissions for public resources, but never
 * bypass the RBAC ceiling; private resources remain creator-only.
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
  // Resolve the caller's grants once: the resource-admin check below matches a
  // second action, and re-resolving would double the RBAC round trips on the
  // per-target conversation guards.
  const resolvedPermissions =
    grantedPermissions ?? (await resolveWorkspaceGrantedPermissions({ db, userId, workspaceId }));
  const { hasAllScope, hasOwnerScope } = await getWorkspaceScopedPermissionMatches({
    action: rbacAction,
    db,
    grantedPermissions: resolvedPermissions,
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
  // Collaboratively-configured workspace infrastructure answers to workspace
  // capability, not to the member who first materialized the row. A hand-built
  // `meta` may not carry the slug, so fill it in rather than misclassifying.
  const needsBuiltinMarkers =
    resourceType === 'agent' && (meta.slug === undefined || meta.virtual === undefined);
  const resolvedMeta = needsBuiltinMarkers
    ? { ...meta, ...(await resolveAgentBuiltinMarkers(db, resourceId)) }
    : meta;
  // Only reserved-slug + provisioned rows reach the membership query, so ordinary
  // agents pay nothing for it.
  const isBuiltinCandidate = !isPrivate && isCollaborativeBuiltinAgent(resourceType, resolvedMeta);
  const isSharedWorkspaceAgent = isBuiltinCandidate && !(await isGroupMemberAgent(db, resourceId));

  if (action === 'manage')
    return isCreator || (!isPrivate && hasAllScope) || isSharedWorkspaceAgent;
  if (action === 'delete') return isCreator || (!isPrivate && hasAllScope);

  if (isCreator) return true;
  // Collaboratively-configured workspace infrastructure is not creator-owned
  // content, so it does not fall back to the resource's General access level.
  if (isSharedWorkspaceAgent) return true;
  if (isPrivate) return false;

  // Ordinary members hold `READ:all` and `AI_MODEL_INVOKE:all`; those are the
  // capability ceiling, not an admin grant that may bypass General Access.
  const resourceEditAction = RESOURCE_ACTIONS[resourceType].edit;
  const hasResourceAdminScope =
    rbacAction === resourceEditAction
      ? hasAllScope
      : (
          await getWorkspaceScopedPermissionMatches({
            action: resourceEditAction,
            db,
            grantedPermissions: resolvedPermissions,
            userId,
            workspaceId,
          })
        ).hasAllScope;
  if (hasResourceAdminScope) return true;

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
