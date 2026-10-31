import type { AgentOperationStatus } from '@lobechat/types';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

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
