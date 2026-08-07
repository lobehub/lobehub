import { and, desc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';

import {
  agentHistoryJobAgents,
  agentHistoryJobs,
  agentHistoryJobTopics,
  messageChunks,
  messageGroups,
  messagePlugins,
  messageQueries,
  messageQueryChunks,
  messages,
  messagesFiles,
  messageTranslates,
  messageTTS,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

/** Transfer rejected: the agent already has an unfinished backfill job. */
export const AGENT_TRANSFER_IN_PROGRESS = 'AGENT_TRANSFER_IN_PROGRESS';
/** Owner delete rejected: a pending backfill still references this owner. */
export const AGENT_TRANSFER_PENDING_OWNER_DELETE = 'AGENT_TRANSFER_PENDING_OWNER_DELETE';

/**
 * Above this many messages the transfer stops rewriting message scope inline
 * and records an async backfill job instead. Rewriting a message row pays for
 * every message index (incl. the multi-GB BM25 index), ~5ms/row in production,
 * so the sync path is capped at a few seconds' worth of rows.
 */
export const getAgentTransferSyncMessageThreshold = (): number => {
  const raw = Number(process.env.AGENT_TRANSFER_SYNC_MESSAGE_THRESHOLD);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1000;
};

export interface AgentTransferTargetScope {
  userId: string;
  workspaceId: string | null;
}

type Executor = Pick<LobeChatDatabase, 'execute'> | Transaction;

/**
 * Message child tables that denormalize the parent message's scope snapshot.
 * Each entry is rewritten with `UPDATE child … FROM messages` on the given
 * anchor column, so the child always follows whatever set of parent messages
 * the caller's condition selects.
 */
const MESSAGE_CHILD_ANCHORS = [
  { anchor: messagePlugins.id, table: messagePlugins },
  { anchor: messageTranslates.id, table: messageTranslates },
  { anchor: messageTTS.id, table: messageTTS },
  { anchor: messagesFiles.messageId, table: messagesFiles },
  { anchor: messageQueries.messageId, table: messageQueries },
  { anchor: messageQueryChunks.messageId, table: messageQueryChunks },
  { anchor: messageChunks.messageId, table: messageChunks },
] as const;

/**
 * Move ALL message rows anchored to the given topics — plus their child-table
 * rows and the topics' message_groups — into the target scope.
 *
 * Anchoring on `topic_id` (instead of the transfer's session/agent linkage) is
 * deliberate: it also captures rows that carry ONLY a topicId (the OpenAPI
 * create shape: `agentId` optional, `sessionId` always null), which the legacy
 * linkage-based rewrite missed and left stranded in the source scope.
 *
 * Raw SQL keeps `updated_at` untouched (a scope transfer does not make content
 * newer), and every statement is a pure function of (topicIds, target), so
 * re-running after a crash is idempotent.
 */
export const rewriteMessageScopeForTopics = async (
  executor: Executor,
  topicIds: string[],
  target: AgentTransferTargetScope,
): Promise<void> => {
  if (topicIds.length === 0) return;

  const inTopics = inArray(messages.topicId, topicIds);

  await executor.execute(sql`
    UPDATE ${messages}
    SET user_id = ${target.userId}, workspace_id = ${target.workspaceId}
    WHERE ${inTopics}
  `);

  for (const { anchor, table } of MESSAGE_CHILD_ANCHORS) {
    await executor.execute(sql`
      UPDATE ${table}
      SET user_id = ${target.userId}, workspace_id = ${target.workspaceId}
      FROM ${messages}
      WHERE ${anchor} = ${messages.id} AND ${inTopics}
    `);
  }

  await executor.execute(sql`
    UPDATE ${messageGroups}
    SET user_id = ${target.userId}, workspace_id = ${target.workspaceId}
    WHERE ${inArray(messageGroups.topicId, topicIds)}
  `);
};

/**
 * Move topicless message rows (and their child rows) that belong to the
 * transferred sessions/agents. These have no topic to anchor a per-topic batch
 * on, so they are rewritten as one residual step when a job finishes — their
 * volume is bounded by construction (chat flows always attach a topic).
 */
export const rewriteResidualMessageScope = async (
  executor: Executor,
  linkage: { agentIds: string[]; groupIds?: string[]; sessionIds: string[] },
  target: AgentTransferTargetScope,
): Promise<void> => {
  const arms: SQL[] = [];
  if (linkage.sessionIds.length > 0) arms.push(inArray(messages.sessionId, linkage.sessionIds));
  if (linkage.agentIds.length > 0) arms.push(inArray(messages.agentId, linkage.agentIds));
  if (linkage.groupIds && linkage.groupIds.length > 0)
    arms.push(inArray(messages.groupId, linkage.groupIds));
  if (arms.length === 0) return;

  const residual = and(isNull(messages.topicId), arms.length === 1 ? arms[0] : or(...arms));

  await executor.execute(sql`
    UPDATE ${messages}
    SET user_id = ${target.userId}, workspace_id = ${target.workspaceId}
    WHERE ${residual}
  `);

  for (const { anchor, table } of MESSAGE_CHILD_ANCHORS) {
    await executor.execute(sql`
      UPDATE ${table}
      SET user_id = ${target.userId}, workspace_id = ${target.workspaceId}
      FROM ${messages}
      WHERE ${anchor} = ${messages.id} AND ${residual}
    `);
  }
};

export interface CreateAgentTransferJobParams {
  agentIds: string[];
  groupIds?: string[];
  sessionIds: string[];
  source: AgentTransferTargetScope;
  target: AgentTransferTargetScope;
  /** Topics whose messages await rewrite; `activityAt` orders the drain. */
  topics: { activityAt: Date; id: string }[];
}

export interface AgentTransferJobProgress {
  completedTopics: number;
  id: string;
  status: 'pending' | 'completed';
  totalTopics: number;
}

/**
 * Async agent-transfer backfill jobs: creation inside the transfer
 * transaction, guard predicates for concurrent transfer / owner deletion, and
 * the per-topic drain the job drivers call.
 *
 * Methods are static — jobs are system-scoped bookkeeping, not user data; the
 * synchronous transfer transaction already authorized the operation.
 */
export class AgentTransferJobModel {
  static createJob = async (
    trx: Transaction | LobeChatDatabase,
    params: CreateAgentTransferJobParams,
  ): Promise<string> => {
    const [job] = await trx
      .insert(agentHistoryJobs)
      .values({
        agentIds: params.agentIds,
        groupIds: params.groupIds ?? [],
        sessionIds: params.sessionIds,
        sourceUserId: params.source.userId,
        sourceWorkspaceId: params.source.workspaceId,
        targetUserId: params.target.userId,
        targetWorkspaceId: params.target.workspaceId,
        totalTopics: params.topics.length,
      })
      .returning({ id: agentHistoryJobs.id });

    if (params.agentIds.length > 0) {
      await trx
        .insert(agentHistoryJobAgents)
        .values(params.agentIds.map((agentId) => ({ agentId, jobId: job.id })));
    }
    // Chunked so a pathological agent (tens of thousands of topics) cannot
    // blow the Postgres per-statement parameter cap (65535; 4 params/row).
    const TOPIC_INSERT_CHUNK = 5000;
    for (let i = 0; i < params.topics.length; i += TOPIC_INSERT_CHUNK) {
      await trx.insert(agentHistoryJobTopics).values(
        params.topics.slice(i, i + TOPIC_INSERT_CHUNK).map((topic) => ({
          activityAt: topic.activityAt,
          jobId: job.id,
          topicId: topic.id,
        })),
      );
    }
    return job.id;
  };

  /** Any of the agents already covered by an unfinished job? */
  static hasPendingJobForAgents = async (
    db: Transaction | LobeChatDatabase,
    agentIds: string[],
  ): Promise<boolean> => {
    if (agentIds.length === 0) return false;
    const [row] = await db
      .select({ jobId: agentHistoryJobAgents.jobId })
      .from(agentHistoryJobAgents)
      .innerJoin(agentHistoryJobs, eq(agentHistoryJobs.id, agentHistoryJobAgents.jobId))
      .where(
        and(
          inArray(agentHistoryJobAgents.agentId, agentIds),
          eq(agentHistoryJobs.status, 'pending'),
        ),
      )
      .limit(1);
    return !!row;
  };

  /**
   * A pending job still references this owner (as source or target). Deleting
   * the owner now would cascade away message rows whose snapshot columns have
   * not been rewritten yet.
   */
  static hasPendingJobTouchingUser = async (
    db: Transaction | LobeChatDatabase,
    userId: string,
  ): Promise<boolean> => {
    const [row] = await db
      .select({ id: agentHistoryJobs.id })
      .from(agentHistoryJobs)
      .where(
        and(
          eq(agentHistoryJobs.status, 'pending'),
          or(eq(agentHistoryJobs.sourceUserId, userId), eq(agentHistoryJobs.targetUserId, userId)),
        ),
      )
      .limit(1);
    return !!row;
  };

  static hasPendingJobTouchingWorkspace = async (
    db: Transaction | LobeChatDatabase,
    workspaceId: string,
  ): Promise<boolean> => {
    const [row] = await db
      .select({ id: agentHistoryJobs.id })
      .from(agentHistoryJobs)
      .where(
        and(
          eq(agentHistoryJobs.status, 'pending'),
          or(
            eq(agentHistoryJobs.sourceWorkspaceId, workspaceId),
            eq(agentHistoryJobs.targetWorkspaceId, workspaceId),
          ),
        ),
      )
      .limit(1);
    return !!row;
  };

  static findPendingJobForAgent = async (
    db: LobeChatDatabase,
    agentId: string,
  ): Promise<AgentTransferJobProgress | undefined> => {
    const [row] = await db
      .select({
        completedTopics: agentHistoryJobs.completedTopics,
        id: agentHistoryJobs.id,
        status: agentHistoryJobs.status,
        totalTopics: agentHistoryJobs.totalTopics,
      })
      .from(agentHistoryJobAgents)
      .innerJoin(agentHistoryJobs, eq(agentHistoryJobs.id, agentHistoryJobAgents.jobId))
      .where(
        and(eq(agentHistoryJobAgents.agentId, agentId), eq(agentHistoryJobs.status, 'pending')),
      )
      .limit(1);
    return row;
  };

  /**
   * Topic ids of a pending job that still await rewrite (UI gray-out set).
   *
   * When `candidateTopicIds` is given, only their intersection with the queue
   * is returned: a job can hold tens of thousands of queued topics, so status
   * polls ask about the topics they can actually show instead of shipping the
   * whole queue to every viewing client.
   */
  static getPendingTopicIds = async (
    db: LobeChatDatabase,
    jobId: string,
    candidateTopicIds?: string[],
  ): Promise<string[]> => {
    if (candidateTopicIds && candidateTopicIds.length === 0) return [];
    const rows = await db
      .select({ topicId: agentHistoryJobTopics.topicId })
      .from(agentHistoryJobTopics)
      .where(
        and(
          eq(agentHistoryJobTopics.jobId, jobId),
          candidateTopicIds ? inArray(agentHistoryJobTopics.topicId, candidateTopicIds) : undefined,
        ),
      );
    return rows.map((row) => row.topicId);
  };

  /** Is this topic still awaiting its scope rewrite under a pending job? */
  static findPendingJobForTopic = async (
    db: LobeChatDatabase,
    topicId: string,
  ): Promise<{ jobId: string } | undefined> => {
    const [row] = await db
      .select({ jobId: agentHistoryJobTopics.jobId })
      .from(agentHistoryJobTopics)
      .innerJoin(agentHistoryJobs, eq(agentHistoryJobs.id, agentHistoryJobTopics.jobId))
      .where(
        and(eq(agentHistoryJobTopics.topicId, topicId), eq(agentHistoryJobs.status, 'pending')),
      )
      .limit(1);
    return row;
  };

  /**
   * Jump-the-queue: the user opened a topic that is still pending, so the next
   * `processNextTopic` call picks it first. Returns whether a pending row was
   * actually flagged (false → the topic already migrated; caller can refetch).
   */
  static prioritizeTopic = async (db: LobeChatDatabase, topicId: string): Promise<boolean> => {
    const rows = await db
      .update(agentHistoryJobTopics)
      .set({ priority: true })
      .where(
        and(
          eq(agentHistoryJobTopics.topicId, topicId),
          inArray(
            agentHistoryJobTopics.jobId,
            db
              .select({ id: agentHistoryJobs.id })
              .from(agentHistoryJobs)
              .where(eq(agentHistoryJobs.status, 'pending')),
          ),
        ),
      )
      .returning({ topicId: agentHistoryJobTopics.topicId });
    return rows.length > 0;
  };

  /**
   * Drain one unit of work: claim the next pending topic (priority first, then
   * most recently active), rewrite its message scope, and delete its queue row
   * — all in one transaction, so a crash between steps re-runs the same topic
   * idempotently instead of skipping it.
   *
   * When no topic remains, run the residual (topicless) rewrite and flip the
   * job to `completed`. The `status = 'pending'` compare-and-set makes the
   * finalization single-winner under concurrent workers; the residual rewrite
   * itself is idempotent, so a double run before the CAS is harmless.
   *
   * Returns `done: true` once the job has nothing left (including the call
   * that performed finalization).
   */
  static processNextTopic = async (
    db: LobeChatDatabase,
    jobId: string,
  ): Promise<{ done: boolean; topicId?: string }> => {
    return db.transaction(async (trx) => {
      const [job] = await trx
        .select()
        .from(agentHistoryJobs)
        .where(eq(agentHistoryJobs.id, jobId))
        .for('update')
        .limit(1);
      if (!job || job.status === 'completed') return { done: true };

      const target = { userId: job.targetUserId, workspaceId: job.targetWorkspaceId };

      const [next] = await trx
        .select({ topicId: agentHistoryJobTopics.topicId })
        .from(agentHistoryJobTopics)
        .where(eq(agentHistoryJobTopics.jobId, jobId))
        .orderBy(desc(agentHistoryJobTopics.priority), desc(agentHistoryJobTopics.activityAt))
        .limit(1);

      if (!next) {
        await rewriteResidualMessageScope(
          trx,
          { agentIds: job.agentIds, groupIds: job.groupIds, sessionIds: job.sessionIds },
          target,
        );
        await trx
          .update(agentHistoryJobs)
          .set({ completedAt: new Date(), status: 'completed' })
          .where(and(eq(agentHistoryJobs.id, jobId), eq(agentHistoryJobs.status, 'pending')));
        return { done: true };
      }

      await rewriteMessageScopeForTopics(trx, [next.topicId], target);
      await trx
        .delete(agentHistoryJobTopics)
        .where(
          and(
            eq(agentHistoryJobTopics.jobId, jobId),
            eq(agentHistoryJobTopics.topicId, next.topicId),
          ),
        );
      await trx
        .update(agentHistoryJobs)
        .set({ completedTopics: sql`${agentHistoryJobs.completedTopics} + 1` })
        .where(eq(agentHistoryJobs.id, jobId));

      return { done: false, topicId: next.topicId };
    });
  };

  /**
   * Run a job to completion. The in-process default driver calls this;
   * step-based drivers (workflows) call `processNextTopic` directly.
   */
  static drain = async (db: LobeChatDatabase, jobId: string): Promise<void> => {
    while (true) {
      const { done } = await AgentTransferJobModel.processNextTopic(db, jobId);
      if (done) return;
    }
  };

  /** Pending jobs left over from a crash/restart — the driver re-arms these. */
  static listPendingJobIds = async (db: LobeChatDatabase): Promise<string[]> => {
    const rows = await db
      .select({ id: agentHistoryJobs.id })
      .from(agentHistoryJobs)
      .where(eq(agentHistoryJobs.status, 'pending'));
    return rows.map((row) => row.id);
  };
}
