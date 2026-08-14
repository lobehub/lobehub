import { and, desc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';

import {
  agentHistoryJobAgents,
  agentHistoryJobGroups,
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

/**
 * One member agent's redirection during a group transfer: the group left a
 * referenced member behind and took a clone of it instead.
 */
export interface AgentIdRemapPair {
  newAgentId: string;
  sourceAgentId: string;
}

/**
 * Repoint `messages.agent_id` / `messages.target_id` from agents that stayed
 * in the source scope onto the clones the group took with it.
 *
 * Runs on exactly the message rows the surrounding scope rewrite selects, so
 * the two always agree about what "this group's history" means, and stays a
 * pure function of (condition, pairs) so a retried drain is idempotent — a
 * second pass simply matches no rows.
 */
const remapMessageAgentIds = async (
  executor: Executor,
  condition: SQL,
  pairs: AgentIdRemapPair[],
): Promise<void> => {
  if (pairs.length === 0) return;

  const remapValues = sql.join(
    pairs.map((pair) => sql`(${pair.sourceAgentId}, ${pair.newAgentId})`),
    sql`, `,
  );

  await executor.execute(sql`
    UPDATE ${messages}
    SET agent_id = _remap.new_id
    FROM (VALUES ${remapValues}) AS _remap(source_id, new_id)
    WHERE ${messages.agentId} = _remap.source_id AND ${condition}
  `);

  // `target_id` records who a message was addressed to in a group thread. It
  // carries no foreign key, so a stale value cannot cascade anything away — but
  // leaving it pointed at the source scope would make "@mention" attribution in
  // the moved history resolve to an agent the new scope cannot see. The group
  // copy path remaps it for the same reason (`_amap_target`).
  await executor.execute(sql`
    UPDATE ${messages}
    SET target_id = _remap.new_id
    FROM (VALUES ${remapValues}) AS _remap(source_id, new_id)
    WHERE ${messages.targetId} = _remap.source_id AND ${condition}
  `);
};

/** {@link remapMessageAgentIds} over the messages of the given topics. */
export const remapMessageAgentIdsForTopics = async (
  executor: Executor,
  topicIds: string[],
  pairs: AgentIdRemapPair[],
): Promise<void> => {
  if (topicIds.length === 0) return;

  await remapMessageAgentIds(executor, inArray(messages.topicId, topicIds), pairs);
};

/**
 * {@link remapMessageAgentIds} over the topicless residue of the given groups —
 * the same rows `rewriteResidualMessageScope` picks up on its group arm.
 */
export const remapResidualMessageAgentIds = async (
  executor: Executor,
  groupIds: string[],
  pairs: AgentIdRemapPair[],
): Promise<void> => {
  if (groupIds.length === 0) return;

  await remapMessageAgentIds(
    executor,
    and(isNull(messages.topicId), inArray(messages.groupId, groupIds))!,
    pairs,
  );
};

/**
 * The owner-delete guards below match ONLY pending `transfer` jobs.
 *
 * A transfer re-homes existing rows, so between the synchronous half and the
 * drain the message snapshot columns still point at the other side — deleting
 * either side would cascade away history that already belongs elsewhere. That
 * is worth blocking a delete for, and the window is minutes.
 *
 * A `copy` job never moves an existing row: the source stays intact and the
 * target is a fresh duplicate, so a delete on either side can only cost a
 * half-finished copy. Both directions also self-heal:
 *
 * - source gone → the per-topic drain's `sourceTopicExists` check fails and
 *   `deleteEmptyTargetTopic` drops the empty shell (same path as the user
 *   deleting the conversation mid-copy, which is likewise never blocked);
 * - target gone → `agent_history_job_topics.topic_id` cascades with the target
 *   topics, so the queue empties and the next drain flips the job `completed`.
 *
 * Blocking on copy jobs is therefore pure cost: copy sits on the ordinary user
 * path (importing a heavy agent into a workspace), so it would let any member
 * wedge an owner's workspace/account deletion — after the caller has already
 * cancelled Stripe and wiped the billing rows.
 */
const isPendingTransfer = () =>
  and(eq(agentHistoryJobs.status, 'pending'), eq(agentHistoryJobs.type, 'transfer'));

export interface CreateAgentTransferJobParams {
  /**
   * Group-transfer member redirections, applied to every message row this job
   * rewrites. Empty for an agent transfer, and for a group whose roster is all
   * group-owned.
   */
  agentIdRemap?: AgentIdRemapPair[];
  /**
   * Agents this job covers: one junction row each, which is what the guards
   * and the progress badge read. NOT automatically the residual linkage — see
   * `residualAgentIds`.
   */
  agentIds: string[];
  groupIds?: string[];
  /**
   * Agent linkage for the final topicless-residual rewrite; defaults to
   * `agentIds`.
   *
   * A GROUP transfer passes `[]`. Its synchronous half rewrites residual
   * messages by group only — a member agent's own topicless rows are not the
   * group's to move (the group transfer does not move that agent's own topics
   * either). Letting the drain fall back to `agentIds` would make a heavy
   * group transfer move strictly more than a small one: exactly the fast/slow
   * drift this framework exists to avoid.
   */
  residualAgentIds?: string[];
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
  /** Job kind (`transfer` | `copy`) — the UI words its progress hints by it. */
  type: string;
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
        // The COLUMN is the residual-rewrite snapshot the drain reads back;
        // the junction below is the coverage set. They differ for a group job.
        agentIds: params.residualAgentIds ?? params.agentIds,
        groupIds: params.groupIds ?? [],
        // `payload` is the generic per-job slot; the remap only exists for
        // group transfers, so it stays out of the columns.
        payload:
          params.agentIdRemap && params.agentIdRemap.length > 0
            ? { agentIdRemap: params.agentIdRemap }
            : undefined,
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
    if (params.groupIds && params.groupIds.length > 0) {
      await trx
        .insert(agentHistoryJobGroups)
        .values(params.groupIds.map((groupId) => ({ groupId, jobId: job.id })));
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

  /**
   * Any of the agents already covered by an unfinished job?
   *
   * Type-agnostic on purpose. A `copy` registers its NEW agent here, and that
   * agent is exactly the one a concurrent transfer must not move: the copy's
   * drain keeps writing history into the scope the transfer just rewrote, so
   * the conversation ends up split across both scopes. Exempting `copy` from
   * the OWNER-DELETE guards is a separate judgement — it does not
   * extend to agent mutations.
   */
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
   * Agents a pending group transfer is still remapping AWAY from.
   *
   * Deliberately separate from {@link hasPendingJobForAgents}: these agents did
   * not move and are not covered by the job, so registering them in the
   * junction would light the migration badge on an agent whose own history is
   * sitting still ({@link findPendingJobForAgent} keys off that same table).
   * But until the drain reaches every topic, undrained rows still carry
   * `messages.agent_id = sourceAgentId`, and that column is ON DELETE CASCADE —
   * so deleting one of these mid-drain would take the moved history with it,
   * the very rows the remap was about to rescue.
   *
   * Guard the delete; leave the badge alone.
   */
  static hasPendingRemapForSourceAgents = async (
    db: Transaction | LobeChatDatabase,
    agentIds: string[],
  ): Promise<boolean> => {
    if (agentIds.length === 0) return false;

    const [row] = await db
      .select({ id: agentHistoryJobs.id })
      .from(agentHistoryJobs)
      .where(
        and(
          eq(agentHistoryJobs.status, 'pending'),
          eq(agentHistoryJobs.type, 'transfer'),
          // COALESCE covers both a NULL payload (the common case for a plain
          // agent transfer) and a payload that carries no remap.
          sql`EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              COALESCE(${agentHistoryJobs.payload} -> 'agentIdRemap', '[]'::jsonb)
            ) AS remap
            WHERE remap ->> 'sourceAgentId' IN (${sql.join(
              agentIds.map((id) => sql`${id}`),
              sql`, `,
            )})
          )`,
        ),
      )
      .limit(1);

    return !!row;
  };

  /**
   * Any of the chat groups already covered by an unfinished job?
   *
   * Not redundant with {@link hasPendingJobForAgents}: a group's guard cannot
   * lean on its member agents alone, because a group with an empty roster
   * registers no agent rows and would slip through unguarded.
   *
   * Type-agnostic for the same reason as {@link hasPendingJobForAgents}.
   */
  static hasPendingJobForGroups = async (
    db: Transaction | LobeChatDatabase,
    groupIds: string[],
  ): Promise<boolean> => {
    if (groupIds.length === 0) return false;
    const [row] = await db
      .select({ jobId: agentHistoryJobGroups.jobId })
      .from(agentHistoryJobGroups)
      .innerJoin(agentHistoryJobs, eq(agentHistoryJobs.id, agentHistoryJobGroups.jobId))
      .where(
        and(
          inArray(agentHistoryJobGroups.groupId, groupIds),
          eq(agentHistoryJobs.status, 'pending'),
        ),
      )
      .limit(1);
    return !!row;
  };

  /**
   * A pending TRANSFER job still references this owner (as source or target).
   * Deleting the owner now would cascade away message rows whose snapshot
   * columns have not been rewritten yet.
   *
   * `copy` jobs are deliberately excluded — see {@link isPendingTransfer}.
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
          isPendingTransfer(),
          or(eq(agentHistoryJobs.sourceUserId, userId), eq(agentHistoryJobs.targetUserId, userId)),
        ),
      )
      .limit(1);
    return !!row;
  };

  /** Workspace counterpart of {@link hasPendingJobTouchingUser}. */
  static hasPendingJobTouchingWorkspace = async (
    db: Transaction | LobeChatDatabase,
    workspaceId: string,
  ): Promise<boolean> => {
    const [row] = await db
      .select({ id: agentHistoryJobs.id })
      .from(agentHistoryJobs)
      .where(
        and(
          isPendingTransfer(),
          or(
            eq(agentHistoryJobs.sourceWorkspaceId, workspaceId),
            eq(agentHistoryJobs.targetWorkspaceId, workspaceId),
          ),
        ),
      )
      .limit(1);
    return !!row;
  };

  /**
   * Progress of the job covering this agent, for the migration badge.
   *
   * Deliberately NOT filtered to `type = 'transfer'` — the same reason spelled
   * out on {@link findPendingJobForGroup}: a heavy agent COPY drives the very
   * same badge and topic gray-out, and the returned `type` is what the client
   * words its progress hints by.
   */
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
        type: agentHistoryJobs.type,
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
   * Group counterpart of {@link findPendingJobForAgent}, for the group badge.
   *
   * Deliberately NOT filtered to `type = 'transfer'`: a group's badge, topic
   * gray-out and pending-topic gating must cover a heavy group COPY as well —
   * its queue rows point at freshly created topic shells that would otherwise
   * render as empty, writable conversations. The returned `type` is what the
   * UI words its progress hints by.
   */
  static findPendingJobForGroup = async (
    db: LobeChatDatabase,
    groupId: string,
  ): Promise<AgentTransferJobProgress | undefined> => {
    const [row] = await db
      .select({
        completedTopics: agentHistoryJobs.completedTopics,
        id: agentHistoryJobs.id,
        status: agentHistoryJobs.status,
        totalTopics: agentHistoryJobs.totalTopics,
        type: agentHistoryJobs.type,
      })
      .from(agentHistoryJobGroups)
      .innerJoin(agentHistoryJobs, eq(agentHistoryJobs.id, agentHistoryJobGroups.jobId))
      .where(
        and(eq(agentHistoryJobGroups.groupId, groupId), eq(agentHistoryJobs.status, 'pending')),
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

  /**
   * Is this topic still awaiting its rewrite under a pending job?
   *
   * Type-agnostic: this backs open-to-prioritize, and a copy's queued topic
   * shell needs jumping the queue just as much as a transfer's.
   */
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
   *
   * Type-agnostic, like {@link findPendingJobForTopic} which selects the job
   * this then kicks.
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
      // Mirror of `AgentCopyJobModel.processNextTopic`'s own type check: running
      // transfer logic over a `copy` job would rewrite the scope of its target
      // topics and drop their queue rows, reporting success against history it
      // never duplicated (see the `type` column's schema comment).
      if (!job || job.type !== 'transfer' || job.status === 'completed') return { done: true };

      const target = { userId: job.targetUserId, workspaceId: job.targetWorkspaceId };
      // A group transfer that left referenced members behind also has to move
      // their lines of the transcript onto the clones it took. Same fast/slow
      // contract as the scope rewrite itself: the synchronous branch does this
      // inline, so the drain must do it on exactly the same rows.
      const agentIdRemap = job.payload?.agentIdRemap;

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
        if (agentIdRemap) await remapResidualMessageAgentIds(trx, job.groupIds, agentIdRemap);
        await trx
          .update(agentHistoryJobs)
          .set({ completedAt: new Date(), status: 'completed' })
          .where(
            and(
              eq(agentHistoryJobs.id, jobId),
              eq(agentHistoryJobs.status, 'pending'),
              eq(agentHistoryJobs.type, 'transfer'),
            ),
          );
        return { done: true };
      }

      await rewriteMessageScopeForTopics(trx, [next.topicId], target);
      if (agentIdRemap) await remapMessageAgentIdsForTopics(trx, [next.topicId], agentIdRemap);
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
      // Type-agnostic: the drivers this feeds dispatch by job type
      // (`processNextAgentHistoryJobTopic`), so restricting it to `transfer`
      // would strand every crashed `copy` job as permanently pending.
      .where(eq(agentHistoryJobs.status, 'pending'));
    return rows.map((row) => row.id);
  };
}
