import { and, desc, eq, notExists, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import type { AgentHistoryJobTopicPayload } from '../schemas';
import {
  agentHistoryJobAgents,
  agentHistoryJobGroups,
  agentHistoryJobs,
  agentHistoryJobTopics,
  messages,
  threads,
  topicComments,
  topicDocuments,
  topics,
  topicShares,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { insertInBatches, splitCrossBatchSelfReferences } from '../utils/batchInsert';
import { copyMessagesInDatabase, type IdPair } from '../utils/copyMessagesInDatabase';
import { idGenerator } from '../utils/idGenerator';
import { buildWorkspaceWhere } from '../utils/workspace';
import type { AgentTransferTargetScope } from './agentTransferJob';

/** Copy rejected: the source agent already has an unfinished copy job. */
export const AGENT_COPY_IN_PROGRESS = 'AGENT_COPY_IN_PROGRESS';

/**
 * Above this many source messages an agent copy stops duplicating history
 * inline and records an async copy job instead. Inserting a message row pays
 * for every message index (incl. the multi-GB BM25 index) exactly like the
 * transfer path's per-row rewrite (~5ms/row in production), so the sync copy
 * is capped at a few seconds' worth of rows.
 */
export const getAgentCopySyncMessageThreshold = (): number => {
  const raw = Number(process.env.AGENT_COPY_SYNC_MESSAGE_THRESHOLD);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1000;
};

export interface CreateAgentCopyJobParams {
  /** Source→target agent pairs duplicated by this job (job payload). */
  agents: { newAgentId: string; sourceAgentId: string }[];
  /**
   * Set for a chat-group copy: the source group being forked and the target
   * group its conversations are re-parented onto. Its presence switches the
   * drain to the group remap — every member agent maps through `agents`, which
   * for a group is a MAP, not one pair.
   */
  group?: { newGroupId: string; sourceGroupId: string };
  source: AgentTransferTargetScope;
  target: AgentTransferTargetScope;
  /**
   * Per-topic work units. `newTopicId` is the already-created target topic
   * shell (what the queue row, status polls and gray-out UI key on);
   * `sourceTopicId` is where the drain copies threads/messages from.
   * `newAgentId` / `sourceAgentId` are the agent-copy coordinates and are
   * omitted for a group copy (see `group`).
   */
  topics: {
    activityAt: Date;
    newAgentId?: string;
    newTopicId: string;
    sourceAgentId?: string;
    sourceTopicId: string;
  }[];
}

/**
 * Async agent-copy jobs on the `agent_history_jobs` framework (`type: 'copy'`).
 *
 * A heavy copy creates the target agent(s) and every target topic shell
 * synchronously, then defers thread + message duplication here. The queue rows
 * point at the NEW topics, so the whole transfer-migration UI (progress badge,
 * topic gray-out, open-to-prioritize) applies to the copied agent unchanged.
 *
 * Unlike transfer there is no residual step: the sync copy path never
 * duplicates topicless messages either, so both paths copy the same set.
 *
 * Methods are static — jobs are system-scoped bookkeeping; the creating
 * import transaction already authorized the operation.
 */
export class AgentCopyJobModel {
  static createJob = async (
    trx: Transaction | LobeChatDatabase,
    params: CreateAgentCopyJobParams,
  ): Promise<string> => {
    const [job] = await trx
      .insert(agentHistoryJobs)
      .values({
        agentIds: params.agents.map((pair) => pair.newAgentId),
        // Like `agentIds`, the junction below records the TARGET side: the
        // badge and gray-out belong to the copied group, not the source.
        groupIds: params.group ? [params.group.newGroupId] : [],
        payload: { agents: params.agents, ...(params.group ? { group: params.group } : {}) },
        sessionIds: [],
        sourceUserId: params.source.userId,
        sourceWorkspaceId: params.source.workspaceId,
        targetUserId: params.target.userId,
        targetWorkspaceId: params.target.workspaceId,
        totalTopics: params.topics.length,
        type: 'copy',
      })
      .returning({ id: agentHistoryJobs.id });

    if (params.agents.length > 0) {
      await trx
        .insert(agentHistoryJobAgents)
        .values(params.agents.map((pair) => ({ agentId: pair.newAgentId, jobId: job.id })));
    }
    if (params.group) {
      await trx
        .insert(agentHistoryJobGroups)
        .values({ groupId: params.group.newGroupId, jobId: job.id });
    }
    // Chunked so a pathological agent (tens of thousands of topics) cannot
    // blow the Postgres per-statement parameter cap (65535; ~5 params/row).
    const TOPIC_INSERT_CHUNK = 5000;
    for (let i = 0; i < params.topics.length; i += TOPIC_INSERT_CHUNK) {
      await trx.insert(agentHistoryJobTopics).values(
        params.topics.slice(i, i + TOPIC_INSERT_CHUNK).map((topic) => ({
          activityAt: topic.activityAt,
          jobId: job.id,
          payload: {
            ...(topic.newAgentId ? { newAgentId: topic.newAgentId } : {}),
            ...(topic.sourceAgentId ? { sourceAgentId: topic.sourceAgentId } : {}),
            sourceTopicId: topic.sourceTopicId,
          },
          topicId: topic.newTopicId,
        })),
      );
    }
    return job.id;
  };

  /**
   * Does any unfinished copy job still read from one of these source agents?
   * Guards every source mutation (transfer, delete, second copy) that would
   * make the pending copy silently drain empty topics. Pass `sourceUserId`
   * when known to narrow the scan; workspace-shared agents can be mutated by
   * a member other than the copy's initiator, so guards without a reliable
   * initiator id scan all pending copy jobs (rare, `status+type` filtered).
   * The agent-id overlap is checked in JS instead of a jsonb containment
   * query.
   */
  static hasPendingCopyJobForSourceAgents = async (
    db: Transaction | LobeChatDatabase,
    sourceAgentIds: string[],
    sourceUserId?: string,
  ): Promise<boolean> => {
    if (sourceAgentIds.length === 0) return false;
    const rows = await db
      .select({ payload: agentHistoryJobs.payload })
      .from(agentHistoryJobs)
      .where(
        and(
          eq(agentHistoryJobs.status, 'pending'),
          eq(agentHistoryJobs.type, 'copy'),
          sourceUserId ? eq(agentHistoryJobs.sourceUserId, sourceUserId) : undefined,
        ),
      );
    const wanted = new Set(sourceAgentIds);
    return rows.some((row) => row.payload?.agents?.some((pair) => wanted.has(pair.sourceAgentId)));
  };

  /**
   * Group counterpart of {@link hasPendingCopyJobForSourceAgents}: does any
   * unfinished copy job still read conversations out of one of these groups?
   *
   * The member-agent guard above does not cover this. A group copy queues
   * topics by GROUP, so a group whose roster is empty (or whose members were
   * removed after the copy started) has no agent row to match, yet its topics
   * are still being read.
   */
  static hasPendingCopyJobForSourceGroups = async (
    db: Transaction | LobeChatDatabase,
    sourceGroupIds: string[],
    sourceUserId?: string,
  ): Promise<boolean> => {
    if (sourceGroupIds.length === 0) return false;
    const rows = await db
      .select({ payload: agentHistoryJobs.payload })
      .from(agentHistoryJobs)
      .where(
        and(
          eq(agentHistoryJobs.status, 'pending'),
          eq(agentHistoryJobs.type, 'copy'),
          sourceUserId ? eq(agentHistoryJobs.sourceUserId, sourceUserId) : undefined,
        ),
      );
    const wanted = new Set(sourceGroupIds);
    return rows.some((row) => !!row.payload?.group && wanted.has(row.payload.group.sourceGroupId));
  };

  /**
   * Drain one unit of work: claim the next pending topic (priority first, then
   * most recently active) and duplicate its threads + messages into the target
   * topic shell — all in one transaction with the queue-row delete, so a crash
   * re-runs the same topic atomically instead of leaving half a conversation.
   *
   * When no topic remains, flip the job to `completed`; the
   * `status = 'pending'` compare-and-set makes finalization single-winner
   * under concurrent workers.
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
      if (!job || job.type !== 'copy' || job.status === 'completed') return { done: true };

      const [next] = await trx
        .select({
          payload: agentHistoryJobTopics.payload,
          topicId: agentHistoryJobTopics.topicId,
        })
        .from(agentHistoryJobTopics)
        .where(eq(agentHistoryJobTopics.jobId, jobId))
        .orderBy(desc(agentHistoryJobTopics.priority), desc(agentHistoryJobTopics.activityAt))
        .limit(1);

      if (!next) {
        await trx
          .update(agentHistoryJobs)
          .set({ completedAt: new Date(), status: 'completed' })
          .where(and(eq(agentHistoryJobs.id, jobId), eq(agentHistoryJobs.status, 'pending')));
        return { done: true };
      }

      // The payload TYPE guarantees `sourceTopicId`, but the column holds
      // whatever the row happens to carry — widen to Partial and re-check.
      const { newAgentId, sourceAgentId, sourceTopicId }: Partial<AgentHistoryJobTopicPayload> =
        next.payload ?? {};
      const group = job.payload?.group;
      const source = { userId: job.sourceUserId, workspaceId: job.sourceWorkspaceId };
      const target = { userId: job.targetUserId, workspaceId: job.targetWorkspaceId };
      // A queue row without copy coordinates is unrecoverable garbage — drop it
      // instead of wedging the whole job on an infinite retry. A group unit
      // needs only the source topic: its agent remap is the job-level map.
      const hasCoordinates = group
        ? !!sourceTopicId
        : !!(newAgentId && sourceAgentId && sourceTopicId);
      if (hasCoordinates) {
        const sourceTopicExists = await AgentCopyJobModel.sourceTopicExists(
          trx,
          source,
          sourceTopicId!,
        );

        if (sourceTopicExists) {
          await (group
            ? AgentCopyJobModel.copyGroupTopicContents(trx, {
                agentIdPairs: (job.payload?.agents ?? []).map((pair): IdPair => [
                  pair.sourceAgentId,
                  pair.newAgentId,
                ]),
                newGroupId: group.newGroupId,
                newTopicId: next.topicId,
                source,
                sourceTopicId: sourceTopicId!,
                target,
              })
            : AgentCopyJobModel.copyTopicContents(trx, {
                newAgentId: newAgentId!,
                newTopicId: next.topicId,
                source,
                sourceAgentId: sourceAgentId!,
                sourceTopicId: sourceTopicId!,
                target,
              }));
        } else {
          // The user deleted the conversation while the copy was queued.
          // Deleting is explicit intent, so it is never blocked — but leaving
          // the shell behind would surface a permanently empty topic on the
          // copied agent. Drop the shell instead, and still count the unit as
          // completed so the job's progress can reach its total.
          await AgentCopyJobModel.deleteEmptyTargetTopic(trx, target, next.topicId);
        }
      }

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

  /** Is the queued source topic still there, in the job's source scope? */
  private static sourceTopicExists = async (
    trx: Transaction,
    source: AgentTransferTargetScope,
    sourceTopicId: string,
  ): Promise<boolean> => {
    const [row] = await trx
      .select({ id: topics.id })
      .from(topics)
      .where(
        and(
          eq(topics.id, sourceTopicId),
          buildWorkspaceWhere(
            { userId: source.userId, workspaceId: source.workspaceId ?? undefined },
            topics,
          ),
        ),
      )
      .limit(1);
    return !!row;
  };

  /**
   * Drop a target topic shell whose source vanished mid-copy. The `not exists`
   * guards are the safety belt: the shell is meant to stay empty until the
   * drain fills it (the UI blocks sending into a pending topic), so anything
   * already written there is real user content and must not be deleted.
   *
   * Deleting the topic CASCADES, so the guard covers every table that would go
   * with it and can hold something a user authored: messages, threads, topic
   * comments, attached documents and share links. Checking only messages would
   * let the cascade take any of the others silently. Not covered on purpose:
   * `message_groups` (cannot exist without messages here), the system link
   * tables (`task_topics`, `agent_eval_run_topics`) and this job's own queue
   * row in `agent_history_job_topics`.
   */
  private static deleteEmptyTargetTopic = async (
    trx: Transaction,
    target: AgentTransferTargetScope,
    newTopicId: string,
  ) => {
    const hasNo = (table: PgTable & { topicId: PgColumn }) =>
      notExists(
        trx
          .select({ one: sql`1` })
          .from(table)
          .where(eq(table.topicId, newTopicId)),
      );

    await trx
      .delete(topics)
      .where(
        and(
          eq(topics.id, newTopicId),
          buildWorkspaceWhere(
            { userId: target.userId, workspaceId: target.workspaceId ?? undefined },
            topics,
          ),
          hasNo(messages),
          hasNo(threads),
          hasNo(topicComments),
          hasNo(topicDocuments),
          hasNo(topicShares),
        ),
      );
  };

  /**
   * Duplicate one source topic's threads and messages into an existing target
   * topic shell. Mirrors the synchronous copy path exactly (same remaps, same
   * in-database message copy), scoped to a single topic.
   */
  private static copyTopicContents = async (
    trx: Transaction,
    unit: {
      newAgentId: string;
      newTopicId: string;
      source: AgentTransferTargetScope;
      sourceAgentId: string;
      sourceTopicId: string;
      target: AgentTransferTargetScope;
    },
  ) => {
    const sourceCtx = {
      userId: unit.source.userId,
      workspaceId: unit.source.workspaceId ?? undefined,
    };

    const sourceThreads = await trx.query.threads.findMany({
      orderBy: (thread, { asc }) => [asc(thread.createdAt)],
      where: and(buildWorkspaceWhere(sourceCtx, threads), eq(threads.topicId, unit.sourceTopicId)),
    });
    const threadIdMap = new Map(
      sourceThreads.map((thread) => [thread.id, idGenerator('threads', 16)]),
    );

    // Message bodies never leave the database — only ids are fetched to build
    // the remap tables for the in-database copy (threads also need the map for
    // `sourceMessageId`, which always points inside the same topic).
    const messageIdPairs: IdPair[] = (
      await trx.query.messages.findMany({
        columns: { id: true },
        where: and(
          buildWorkspaceWhere(sourceCtx, messages),
          eq(messages.topicId, unit.sourceTopicId),
        ),
      })
    ).map(({ id }) => [id, idGenerator('messages')]);
    const messageIdMap = new Map(messageIdPairs);

    if (sourceThreads.length > 0) {
      const { fixups: threadFixups, rows: threadRows } = splitCrossBatchSelfReferences(
        sourceThreads.map((thread) => ({
          ...thread,
          agentId: unit.newAgentId,
          clientId: null,
          groupId: null,
          id: threadIdMap.get(thread.id)!,
          parentThreadId: thread.parentThreadId
            ? (threadIdMap.get(thread.parentThreadId) ?? null)
            : null,
          sourceMessageId: thread.sourceMessageId
            ? (messageIdMap.get(thread.sourceMessageId) ?? null)
            : null,
          topicId: unit.newTopicId,
          userId: unit.target.userId,
          workspaceId: unit.target.workspaceId,
        })),
        ['parentThreadId'],
      );

      await insertInBatches(threadRows, (batch) => trx.insert(threads).values(batch));

      for (const fixup of threadFixups) {
        await trx.update(threads).set(fixup.patch).where(eq(threads.id, fixup.id));
      }
    }

    // Copied messages belong to the new agent when they belonged to the source
    // agent (or to no agent); other agents' rows keep their reference — same
    // semantics as the synchronous copy path.
    await copyMessagesInDatabase({
      agentIdExpr: sql`case when ${messages.agentId} is null or ${messages.agentId} = ${unit.sourceAgentId} then ${unit.newAgentId} else ${messages.agentId} end`,
      executor: trx,
      groupId: null,
      messageIdPairs,
      childScope: (table) => buildWorkspaceWhere(sourceCtx, table),
      targetIdExpr: sql`case when ${messages.targetId} = ${unit.sourceAgentId} then ${unit.newAgentId} else ${messages.targetId} end`,
      targetUserId: unit.target.userId,
      targetWorkspaceId: unit.target.workspaceId,
      threadIdPairs: [...threadIdMap.entries()],
      topicIdPairs: [[unit.sourceTopicId, unit.newTopicId]],
    });
  };

  /**
   * Group variant of {@link copyTopicContents}: duplicate one source GROUP
   * topic's threads and messages into an existing target topic shell.
   *
   * The remap differs in kind, not degree. An agent copy has exactly one
   * source→target agent, so it can inline a `case when agent_id = source`
   * expression; a group conversation carries rows from every member, so the
   * whole `agentIdPairs` map is joined (`_amap` / `_amap_target`) and members
   * outside it collapse to NULL. `target_id` also has the literal `'user'`
   * sentinel to preserve. Mirrors the synchronous
   * `AgentGroupRepository.copyGroupConversationHistory`, scoped to one topic.
   */
  private static copyGroupTopicContents = async (
    trx: Transaction,
    unit: {
      agentIdPairs: IdPair[];
      newGroupId: string;
      newTopicId: string;
      source: AgentTransferTargetScope;
      sourceTopicId: string;
      target: AgentTransferTargetScope;
    },
  ) => {
    const sourceCtx = {
      userId: unit.source.userId,
      workspaceId: unit.source.workspaceId ?? undefined,
    };
    const agentIdMap = new Map(unit.agentIdPairs);
    const mapAgentId = (agentId?: null | string) =>
      agentId ? (agentIdMap.get(agentId) ?? null) : null;

    const sourceThreads = await trx.query.threads.findMany({
      orderBy: (thread, { asc }) => [asc(thread.createdAt)],
      where: and(buildWorkspaceWhere(sourceCtx, threads), eq(threads.topicId, unit.sourceTopicId)),
    });
    const threadIdMap = new Map(
      sourceThreads.map((thread) => [thread.id, idGenerator('threads', 16)]),
    );

    // Message bodies never leave the database — only ids are fetched to build
    // the remap tables for the in-database copy.
    const messageIdPairs: IdPair[] = (
      await trx.query.messages.findMany({
        columns: { id: true },
        where: and(
          buildWorkspaceWhere(sourceCtx, messages),
          eq(messages.topicId, unit.sourceTopicId),
        ),
      })
    ).map(({ id }) => [id, idGenerator('messages')]);
    const messageIdMap = new Map(messageIdPairs);

    if (sourceThreads.length > 0) {
      const { fixups: threadFixups, rows: threadRows } = splitCrossBatchSelfReferences(
        sourceThreads.map((thread) => ({
          ...thread,
          agentId: mapAgentId(thread.agentId),
          clientId: null,
          groupId: unit.newGroupId,
          id: threadIdMap.get(thread.id)!,
          parentThreadId: thread.parentThreadId
            ? (threadIdMap.get(thread.parentThreadId) ?? null)
            : null,
          sourceMessageId: thread.sourceMessageId
            ? (messageIdMap.get(thread.sourceMessageId) ?? null)
            : null,
          topicId: unit.newTopicId,
          userId: unit.target.userId,
          workspaceId: unit.target.workspaceId,
        })),
        ['parentThreadId'],
      );

      await insertInBatches(threadRows, (batch) => trx.insert(threads).values(batch));

      for (const fixup of threadFixups) {
        await trx.update(threads).set(fixup.patch).where(eq(threads.id, fixup.id));
      }
    }

    await copyMessagesInDatabase({
      agentIdExpr: sql`_amap.new_id`,
      agentIdPairs: unit.agentIdPairs,
      executor: trx,
      groupId: unit.newGroupId,
      messageIdPairs,
      childScope: (table) => buildWorkspaceWhere(sourceCtx, table),
      targetIdExpr: sql`case when ${messages.targetId} = 'user' then ${messages.targetId} else _amap_target.new_id end`,
      targetUserId: unit.target.userId,
      targetWorkspaceId: unit.target.workspaceId,
      threadIdPairs: [...threadIdMap.entries()],
      topicIdPairs: [[unit.sourceTopicId, unit.newTopicId]],
    });
  };

  /**
   * Run a copy job to completion. In-process drivers call this; step-based
   * drivers (workflows) call `processNextTopic` directly.
   */
  static drain = async (db: LobeChatDatabase, jobId: string): Promise<void> => {
    while (true) {
      const { done } = await AgentCopyJobModel.processNextTopic(db, jobId);
      if (done) return;
    }
  };
}
