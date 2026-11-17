import type { AgentOperationStatus } from '@lobechat/types';
import { and, desc, eq, inArray, isNull, not } from 'drizzle-orm';

import { TopicModel } from '@/database/models/topic';
import { agentOperations } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import type { SteerQueueScope } from '@/server/services/redis/steerQueue';

/** Statuses of a run that still owns its conversation, parked ones included. */
const LIVE_STATUSES: AgentOperationStatus[] = [
  'idle',
  'running',
  'waiting_for_human',
  'waiting_for_async_tool',
  'waiting_for_client',
];

export interface LiveRunContext {
  db: LobeChatDatabase;
  workspaceId?: string | null;
}

/** The topic model's liveness rule; it only reads the operation id off the marker. */
export const isRunAlive = (ctx: LiveRunContext, userId: string, operationId: string) =>
  new TopicModel(ctx.db, userId, ctx.workspaceId ?? undefined).isRunningOperationAlive(ctx.db, {
    assistantMessageId: '',
    operationId,
  });

/**
 * The scope owner's live top-level runs on exactly this surface — the topic's
 * main spine or one thread. A follow-up queues behind one of them and that run
 * drains it; an entry bound to a run outside this set is an orphan any run on
 * the surface may take. Thread runs never claim the topic marker, so the
 * operation rows decide, with the topic model's liveness rule on top.
 */
export const findOwnLiveRuns = async (
  ctx: LiveRunContext,
  scope: SteerQueueScope,
): Promise<string[]> => {
  const candidates = await ctx.db
    .select({ id: agentOperations.id })
    .from(agentOperations)
    .where(
      and(
        eq(agentOperations.topicId, scope.topicId),
        scope.threadId
          ? eq(agentOperations.threadId, scope.threadId)
          : isNull(agentOperations.threadId),
        isNull(agentOperations.parentOperationId),
        eq(agentOperations.userId, scope.userId),
        inArray(agentOperations.status, LIVE_STATUSES),
      ),
    )
    .orderBy(desc(agentOperations.createdAt))
    .limit(3);

  const live: string[] = [];
  for (const { id } of candidates) if (await isRunAlive(ctx, scope.userId, id)) live.push(id);
  return live;
};

/**
 * Of `topicIds`, the ones with a live top-level run that another member (not
 * `userId`) started on the main line. The caller cannot stop those runs, so a
 * flow that retires the topics must leave them alone.
 */
export const findTopicsRunByOthers = async (
  ctx: LiveRunContext,
  params: { topicIds: string[]; userId: string },
): Promise<string[]> => {
  if (params.topicIds.length === 0) return [];
  const candidates = await ctx.db
    .select({
      id: agentOperations.id,
      topicId: agentOperations.topicId,
      userId: agentOperations.userId,
    })
    .from(agentOperations)
    .where(
      and(
        inArray(agentOperations.topicId, params.topicIds),
        isNull(agentOperations.threadId),
        isNull(agentOperations.parentOperationId),
        not(eq(agentOperations.userId, params.userId)),
        inArray(agentOperations.status, LIVE_STATUSES),
        ctx.workspaceId ? eq(agentOperations.workspaceId, ctx.workspaceId) : undefined,
      ),
    );

  const topics = new Set<string>();
  for (const row of candidates) {
    if (!row.topicId || topics.has(row.topicId)) continue;
    if (await isRunAlive(ctx, row.userId, row.id)) topics.add(row.topicId);
  }
  return [...topics];
};
