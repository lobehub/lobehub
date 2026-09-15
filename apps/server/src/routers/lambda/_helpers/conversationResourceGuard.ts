import { inArray } from 'drizzle-orm';

import { RbacModel } from '@/database/models/rbac';
import { agentsToSessions, messages, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  assertCanPerformResourceAction,
  canPerformResourceAction,
  getResourceMeta,
} from '@/server/services/resourcePermission';

import { getWorkspaceAgentParentGroupIds } from './workspaceAgentGuard';

interface ConversationGuardCtx {
  db: LobeChatDatabase;
  grantedPermissions?: readonly string[];
  userId: string;
  workspaceId?: string | null;
}

export interface ConversationTarget {
  agentId?: string | null;
  groupId?: string | null;
}

export interface CreateMessageTarget extends ConversationTarget {
  parentId?: string | null;
  topicId?: string | null;
}

export interface ResolvedConversationTarget {
  meta: NonNullable<Awaited<ReturnType<typeof getResourceMeta>>>;
  resourceId: string;
  resourceType: 'agent' | 'agentGroup';
}

/**
 * Workspace General-access guard for conversations.
 *
 * Workspace topics/messages are visible workspace-wide (`buildWorkspaceWhere`
 * matches every member's rows), so reads still need VIEW access to the owning
 * agent/group. Shared conversation writes require USE access; `view`-level
 * General access remains read-only.
 *
 * Personal mode (no workspaceId) is a no-op. Targets that don't resolve to a
 * workspace-shared agent/group of the CURRENT workspace (inbox, legacy rows,
 * cross-workspace ids) fall through — the models' workspace ownership WHERE
 * already keeps those writes scoped.
 */
const resolveConversationTargets = async (
  ctx: Pick<ConversationGuardCtx, 'db' | 'workspaceId'>,
  targets: ConversationTarget[],
): Promise<ResolvedConversationTarget[]> => {
  const workspaceId = ctx.workspaceId ?? undefined;
  if (!workspaceId || targets.length === 0) return [];

  // A conversation belongs to its group when it has one, otherwise its agent.
  const refs = new Map<string, { resourceId: string; resourceType: 'agent' | 'agentGroup' }>();
  for (const target of targets) {
    if (target.groupId) {
      refs.set(`agentGroup:${target.groupId}`, {
        resourceId: target.groupId,
        resourceType: 'agentGroup',
      });
    }
    if (target.agentId) {
      refs.set(`agent:${target.agentId}`, { resourceId: target.agentId, resourceType: 'agent' });
    }
  }

  // Agent-only context is client-supplied and may point directly at a virtual
  // group member. Its conversation capability cannot exceed any parent group,
  // matching the execution and configuration guards.
  const agentRefs = [...refs.values()].filter((ref) => ref.resourceType === 'agent');
  const parentGroupIds = await Promise.all(
    agentRefs.map((ref) =>
      getWorkspaceAgentParentGroupIds({ agentId: ref.resourceId, db: ctx.db, workspaceId }),
    ),
  );
  for (const groupId of parentGroupIds.flat()) {
    refs.set(`agentGroup:${groupId}`, { resourceId: groupId, resourceType: 'agentGroup' });
  }

  const resolved: ResolvedConversationTarget[] = [];
  for (const { resourceId, resourceType } of refs.values()) {
    const meta = await getResourceMeta(ctx.db, resourceType, resourceId);
    // Not a resource of the current workspace — nothing to guard at this
    // layer; the ownership WHERE keeps foreign ids unreachable anyway.
    if (!meta || meta.workspaceId !== workspaceId) continue;

    resolved.push({ meta, resourceId, resourceType });
  }

  return resolved;
};

const assertCanAccessConversationTargets = async (
  ctx: ConversationGuardCtx,
  targets: ConversationTarget[],
  action: 'use' | 'view',
): Promise<ResolvedConversationTarget[]> => {
  const workspaceId = ctx.workspaceId ?? undefined;
  if (!workspaceId) return [];

  const resolved = await resolveConversationTargets(ctx, targets);
  for (const { meta, resourceId, resourceType } of resolved) {
    await assertCanPerformResourceAction({
      action,
      db: ctx.db,
      grantedPermissions: ctx.grantedPermissions,
      meta,
      resourceId,
      resourceType,
      userId: ctx.userId,
      workspaceId,
    });
  }
  return resolved;
};

export const assertCanUseConversationTargets = async (
  ctx: ConversationGuardCtx,
  targets: ConversationTarget[],
): Promise<ResolvedConversationTarget[]> => assertCanAccessConversationTargets(ctx, targets, 'use');

/**
 * Assert read-only access to authoritative agent/group context and return the
 * resources that were actually checked. An empty workspace result is a
 * vacuous pass, not authorization; token/operation callers must fail closed or
 * fall back to an independently resolved topic resource.
 */
export const assertCanViewConversationTargets = async (
  ctx: ConversationGuardCtx,
  targets: ConversationTarget[],
): Promise<ResolvedConversationTarget[]> =>
  assertCanAccessConversationTargets(ctx, targets, 'view');

/**
 * Resolve message ids to their owning agent/group from the DB rows (client
 * context is untrusted) and assert `use` access. Rows without a direct
 * agentId/groupId fall back to their topic's linkage.
 */
export const assertCanUseMessageTargets = async (
  ctx: ConversationGuardCtx,
  messageIds: string[],
): Promise<void> => {
  if (!ctx.workspaceId || messageIds.length === 0) return;

  const rows = await ctx.db
    .select({ agentId: messages.agentId, groupId: messages.groupId, topicId: messages.topicId })
    .from(messages)
    .where(inArray(messages.id, messageIds));

  const targets: ConversationTarget[] = [];
  const fallbackTopicIds = new Set<string>();
  for (const row of rows) {
    if (row.agentId || row.groupId) targets.push(row);
    else if (row.topicId) fallbackTopicIds.add(row.topicId);
  }

  await assertCanUseConversationTargets(ctx, targets);
  if (fallbackTopicIds.size > 0) {
    await assertCanUseTopicTargets(ctx, [...fallbackTopicIds]);
  }
};

/**
 * Read-only counterpart used by source-locator Review. Message ids locate the
 * authoritative conversation resource but never grant access themselves.
 * Missing rows are intentionally not treated as authorization; the durable
 * business lookup must require an all-or-none source match and fail closed on
 * partial/mismatched batches.
 */
export const assertCanViewMessageTargets = async (
  ctx: ConversationGuardCtx,
  messageIds: string[],
): Promise<void> => {
  if (!ctx.workspaceId || messageIds.length === 0) return;

  const rows = await ctx.db
    .select({ agentId: messages.agentId, groupId: messages.groupId, topicId: messages.topicId })
    .from(messages)
    .where(inArray(messages.id, messageIds));

  const targets: ConversationTarget[] = [];
  const fallbackTopicIds = new Set<string>();
  for (const row of rows) {
    if (row.agentId || row.groupId) targets.push(row);
    else if (row.topicId) fallbackTopicIds.add(row.topicId);
  }

  await assertCanViewConversationTargets(ctx, targets);
  if (fallbackTopicIds.size > 0) {
    await assertCanViewTopicTargets(ctx, [...fallbackTopicIds]);
  }
};

const resolveTopicTargets = async (
  ctx: Pick<ConversationGuardCtx, 'db' | 'workspaceId'>,
  topicIds: string[],
): Promise<ResolvedConversationTarget[]> => {
  if (!ctx.workspaceId || topicIds.length === 0) return [];

  const rows = await ctx.db
    .select({ agentId: topics.agentId, groupId: topics.groupId, sessionId: topics.sessionId })
    .from(topics)
    .where(inArray(topics.id, topicIds));

  // Backwards-compatible topics may carry only `sessionId` — resolve those
  // through `agentsToSessions`, otherwise a session-backed topic would pass an
  // empty target and skip the guard entirely.
  const unresolvedSessionIds = [
    ...new Set(
      rows
        .filter((row) => !row.agentId && !row.groupId && row.sessionId)
        .map((row) => row.sessionId!),
    ),
  ];
  const sessionTargets: ConversationTarget[] =
    unresolvedSessionIds.length > 0
      ? await ctx.db
          .select({ agentId: agentsToSessions.agentId })
          .from(agentsToSessions)
          .where(inArray(agentsToSessions.sessionId, unresolvedSessionIds))
      : [];

  return resolveConversationTargets(ctx, [...rows, ...sessionTargets]);
};

const assertCanAccessTopicTargets = async (
  ctx: ConversationGuardCtx,
  topicIds: string[],
  action: 'use' | 'view',
): Promise<ResolvedConversationTarget[]> => {
  const workspaceId = ctx.workspaceId ?? undefined;
  if (!workspaceId) return [];

  const resolved = await resolveTopicTargets(ctx, topicIds);
  for (const { meta, resourceId, resourceType } of resolved) {
    await assertCanPerformResourceAction({
      action,
      db: ctx.db,
      grantedPermissions: ctx.grantedPermissions,
      meta,
      resourceId,
      resourceType,
      userId: ctx.userId,
      workspaceId,
    });
  }

  return resolved;
};

/**
 * Resolve topic ids to their owning agent/group and assert `use` access.
 *
 * Returns the conversation resources it actually checked. An EMPTY result is
 * not an approval: a topic with no agent, group or resolvable session backs no
 * resource, so there was nothing to gate on. Callers whose mutation reaches
 * beyond the conversation — publishing a share link, say — must fail closed on
 * that instead of reading the vacuous pass as authorization.
 */
export const assertCanUseTopicTargets = async (
  ctx: ConversationGuardCtx,
  topicIds: string[],
): Promise<ResolvedConversationTarget[]> => assertCanAccessTopicTargets(ctx, topicIds, 'use');

/** Resolve topic ids to their owning agent/group and assert `view` access. */
export const assertCanViewTopicTargets = async (
  ctx: ConversationGuardCtx,
  topicIds: string[],
): Promise<ResolvedConversationTarget[]> => assertCanAccessTopicTargets(ctx, topicIds, 'view');

/**
 * Resolve one set of topic resources, then evaluate every active recipient
 * against that shared metadata. `view` is the minimum resource access level,
 * so supplying it avoids re-reading the same General-access row per user.
 */
export const filterUserIdsByTopicViewAccess = async (
  ctx: Pick<ConversationGuardCtx, 'db' | 'workspaceId'>,
  topicIds: string[],
  userIds: string[],
): Promise<string[]> => {
  const workspaceId = ctx.workspaceId ?? undefined;
  const uniqueUserIds = [...new Set(userIds)];
  if (!workspaceId || uniqueUserIds.length === 0) return [];

  const [resolvedTargets, permissionsByUserId] = await Promise.all([
    resolveTopicTargets(ctx, topicIds),
    RbacModel.getWorkspaceUsersPermissions({
      db: ctx.db,
      requireMembership: true,
      userIds: uniqueUserIds,
      workspaceId,
    }),
  ]);
  const activeUserIds = uniqueUserIds.filter((userId) => permissionsByUserId.has(userId));
  const access = await Promise.all(
    activeUserIds.map(async (userId) => {
      const grantedPermissions = permissionsByUserId.get(userId)!;
      const checks = await Promise.all(
        resolvedTargets.map(({ meta, resourceId, resourceType }) =>
          canPerformResourceAction({
            action: 'view',
            db: ctx.db,
            effectiveAccessLevel: 'view',
            grantedPermissions,
            meta,
            resourceId,
            resourceType,
            userId,
            workspaceId,
          }),
        ),
      );
      return checks.every(Boolean);
    }),
  );

  return activeUserIds.filter((_, index) => access[index]);
};

/**
 * Resolve session ids to their linked agents via `agentsToSessions` and assert
 * `use` access — for session-scoped bulk writes that never see a topic id.
 */
export const assertCanUseSessionTargets = async (
  ctx: ConversationGuardCtx,
  sessionIds: string[],
): Promise<void> => {
  if (!ctx.workspaceId || sessionIds.length === 0) return;

  const targets: ConversationTarget[] = await ctx.db
    .select({ agentId: agentsToSessions.agentId })
    .from(agentsToSessions)
    .where(inArray(agentsToSessions.sessionId, sessionIds));

  await assertCanUseConversationTargets(ctx, targets);
};

/**
 * Guard every authority-bearing field accepted by message creation. Explicit
 * agent/group ids are not authoritative: a caller may omit or forge them while
 * appending through an existing topic or parent message, so all three sources
 * are checked independently.
 */
export const assertCanUseCreateMessageTargets = async (
  ctx: ConversationGuardCtx,
  createMessages: CreateMessageTarget[],
): Promise<void> => {
  if (!ctx.workspaceId || createMessages.length === 0) return;

  const topicIds = [
    ...new Set(createMessages.map((message) => message.topicId).filter(Boolean) as string[]),
  ];
  const parentIds = [
    ...new Set(createMessages.map((message) => message.parentId).filter(Boolean) as string[]),
  ];

  await Promise.all([
    assertCanUseConversationTargets(ctx, createMessages),
    assertCanUseTopicTargets(ctx, topicIds),
    assertCanUseMessageTargets(ctx, parentIds),
  ]);
};
