import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';

import { agentOperations, topics, workspaceMembers } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { notTrashed } from '@/database/utils/softDelete';
import {
  assertCanUseMessageTargets,
  assertCanUseTopicTargets,
} from '@/server/routers/lambda/_helpers/conversationResourceGuard';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';
import type { OperationCompletionShareVisitor } from '@/server/services/agentRuntime/CompletionLifecycle/types';

export const resolveHeteroTopicWorkspace = async (params: {
  db: LobeChatDatabase;
  requestedWorkspaceId?: string | null;
  topicId: string;
  userId: string;
}) => {
  const { db, requestedWorkspaceId, topicId, userId } = params;
  const [topic] = await db
    .select({ userId: topics.userId, workspaceId: topics.workspaceId })
    .from(topics)
    .where(and(eq(topics.id, topicId), notTrashed(topics.isDeleted)))
    .limit(1);

  if (!topic || (requestedWorkspaceId != null && requestedWorkspaceId !== topic.workspaceId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Topic is outside the caller scope' });
  }

  if (!topic.workspaceId) {
    if (topic.userId !== userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Topic is outside the caller scope' });
    }
    return undefined;
  }

  const [membership] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, topic.workspaceId),
        eq(workspaceMembers.userId, userId),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Topic is outside the caller scope' });
  }

  return topic.workspaceId;
};

/**
 * The share visitor a hetero run on this topic belongs to, or `undefined` for
 * an ordinary run. Read from the marker the dispatch stamped on the operation
 * row, and trusted only when the topic really is that visitor's topic
 * (`topics.senderId`). A visitor topic whose operation has no matching marker
 * also resolves to `undefined`: its rows then stay hidden, which drops the
 * run's output rather than exposing it to the wrong scope.
 */
export const resolveHeteroRunShareVisitor = async (params: {
  db: LobeChatDatabase;
  operationId: string;
  topicId: string;
}): Promise<OperationCompletionShareVisitor | undefined> => {
  const { db, operationId, topicId } = params;
  const [row] = await db
    .select({ metadata: agentOperations.metadata, senderId: topics.senderId })
    .from(agentOperations)
    .innerJoin(topics, eq(topics.id, agentOperations.topicId))
    .where(and(eq(agentOperations.id, operationId), eq(agentOperations.topicId, topicId)))
    .limit(1);
  if (!row?.senderId) return undefined;

  const marker = row.metadata?.agentShareVisitor as
    Partial<OperationCompletionShareVisitor> | undefined;
  if (!marker?.shareId || marker.visitorUserId !== row.senderId) return undefined;
  return { shareId: marker.shareId, visitorUserId: marker.visitorUserId };
};

/**
 * Workspace `use` guard for operation-keyed endpoints: resolve the operation
 * row to its agent and run the same `use` guard. Operations without an agent
 * (detached / legacy rows) fall through — there is no resource to guard.
 * No-op in personal mode (no workspaceId).
 */
export const assertCanUseOperationAgent = async (params: {
  db: LobeChatDatabase;
  operationId: string;
  userId: string;
  workspaceId?: string | null;
}) => {
  const { db, operationId, userId, workspaceId } = params;
  if (!workspaceId) return;

  const [row] = await db
    .select({ agentId: agentOperations.agentId })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId))
    .limit(1);
  if (!row?.agentId) return;

  await assertCanUseWorkspaceAgent({
    agentId: row.agentId,
    db,
    userId,
    workspaceId,
  });
};

/**
 * Resolve client-supplied conversation ids before an agent run writes through
 * AiAgentService. Checking only the requested agent/group is insufficient: an
 * existing topic or parent message can belong to a different, view-only
 * workspace resource.
 */
export const assertCanUseAgentRunConversation = async (params: {
  db: LobeChatDatabase;
  messageIds?: Array<string | null | undefined>;
  topicId?: string | null;
  userId: string;
  workspaceId?: string | null;
}) => {
  const { db, messageIds = [], topicId, userId, workspaceId } = params;
  if (!workspaceId) return;

  const uniqueMessageIds = [...new Set(messageIds.filter(Boolean) as string[])];
  // Fixed two-call tuple, not a per-id fan-out: `assertCanUseMessageTargets`
  // resolves every message id in one batched `inArray` query.
  await Promise.all([
    assertCanUseTopicTargets({ db, userId, workspaceId }, topicId ? [topicId] : []),
    assertCanUseMessageTargets({ db, userId, workspaceId }, uniqueMessageIds),
  ]);
};
