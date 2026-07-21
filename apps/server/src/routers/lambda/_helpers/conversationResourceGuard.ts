import { inArray } from 'drizzle-orm';

import { agentsToSessions, messages, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  assertCanPerformResourceAction,
  getResourceMeta,
} from '@/server/services/resourcePermission';

import { getWorkspaceAgentParentGroupIds } from './workspaceAgentGuard';

interface ConversationGuardCtx {
  db: LobeChatDatabase;
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

/**
 * Workspace General-access guard for conversation writes.
 *
 * Workspace topics/messages are visible workspace-wide (`buildWorkspaceWhere`
 * matches every member's rows), and shared conversations are intentionally
 * co-editable by members — but only for members who can at least USE the
 * agent/group the conversation belongs to. `view`-level General access means
 * read-only: no sends, no message edits/deletes, no topic co-edits.
 *
 * Personal mode (no workspaceId) is a no-op. Targets that don't resolve to a
 * workspace-shared agent/group of the CURRENT workspace (inbox, legacy rows,
 * cross-workspace ids) fall through — the models' workspace ownership WHERE
 * already keeps those writes scoped.
 */
export const assertCanUseConversationTargets = async (
  ctx: ConversationGuardCtx,
  targets: ConversationTarget[],
): Promise<void> => {
  const workspaceId = ctx.workspaceId ?? undefined;
  if (!workspaceId || targets.length === 0) return;

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

  for (const { resourceId, resourceType } of refs.values()) {
    const meta = await getResourceMeta(ctx.db, resourceType, resourceId);
    // Not a resource of the current workspace — nothing to guard at this
    // layer; the ownership WHERE keeps foreign ids unreachable anyway.
    if (!meta || meta.workspaceId !== workspaceId) continue;

    await assertCanPerformResourceAction({
      action: 'use',
      db: ctx.db,
      meta,
      resourceId,
      resourceType,
      userId: ctx.userId,
      workspaceId,
    });
  }
};

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
 * Resolve topic ids to their owning agent/group from the DB rows and assert
 * `use` access.
 */
export const assertCanUseTopicTargets = async (
  ctx: ConversationGuardCtx,
  topicIds: string[],
): Promise<void> => {
  if (!ctx.workspaceId || topicIds.length === 0) return;

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

  await assertCanUseConversationTargets(ctx, [...rows, ...sessionTargets]);
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
