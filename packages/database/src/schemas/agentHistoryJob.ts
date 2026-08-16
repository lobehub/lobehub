import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { chatGroups } from './chatGroup';
import { topics } from './topic';

/**
 * Per-job payload, keyed by job `type`. The column is nullable, and NULL
 * encodes "this job carries nothing beyond its columns" — which is still the
 * common case for a plain agent transfer.
 *
 * - `copy` jobs always carry `agents` (and `group` when copying a chat group).
 * - `transfer` jobs carry `agentIdRemap` only when a GROUP transfer left
 *   referenced members behind and took clones instead.
 *
 * The two field sets never co-occur; both are optional so each job type can
 * ignore the other's, and every reader already guards with `?.`.
 */
export interface AgentHistoryJobPayload {
  /**
   * Group-transfer member redirections: rewrite `messages.agent_id` /
   * `target_id` from the member left behind onto the clone that replaced it.
   */
  agentIdRemap?: { newAgentId: string; sourceAgentId: string }[];
  /** Agents duplicated by this job, for guards that only need the id map. */
  agents?: { newAgentId: string; sourceAgentId: string }[];
  /**
   * Present only for a chat-group copy. Its presence is the discriminator the
   * drain uses to pick the group remap (every member agent maps through
   * `agents` above, and copied rows are re-parented onto `newGroupId`) instead
   * of the single-agent remap.
   */
  group?: { newGroupId: string; sourceGroupId: string };
}

/** `copy` queue-row payload. */
export interface AgentHistoryJobTopicPayload {
  /**
   * Agent owning the target topic shell. Agent copies always carry it; group
   * copies leave it out — a group topic's agent remap is the job-level
   * `agents` map, not one pair.
   */
  newAgentId?: string;
  /** Agent the source topic belongs to. Absent for group copies, same reason. */
  sourceAgentId?: string;
  /** Topic to copy messages/threads from. */
  sourceTopicId: string;
}

/**
 * Async bulk jobs over an agent's conversation history.
 *
 * Tables are named generically (`agent_history_jobs`) with a `type`
 * discriminator because the per-topic queue shape is reusable beyond scope
 * transfer — `copy` (async "copy with history") is the second kind, landing on
 * top of this schema. Drivers must route a drain unit by `type`; the business
 * layer keeps transfer-specific naming for the transfer half.
 *
 * A transfer moves agents/sessions/topics synchronously (small tables), but a
 * heavy agent's `messages` (and message child tables) are too expensive to
 * rewrite inline — every row update maintains all message indexes including
 * the multi-GB BM25 full-text index. Above a threshold the message-scope
 * rewrite is recorded here and drained asynchronously, one topic at a time
 * (see `agent_history_job_topics`), so each topic flips atomically into the
 * target scope.
 *
 * The job row IS the source of truth for "a transfer is still in flight":
 * while a job stays `pending`, re-transferring the same agents and deleting
 * the involved users/workspaces are rejected — the message snapshot columns
 * still point at the previous owner, so an owner delete would cascade away
 * history that already belongs to the target scope.
 *
 * No FK onto the source/target owner columns on purpose: guard checks must
 * OBSERVE a pending job instead of the job row disappearing together with the
 * owner it was protecting.
 */
export const agentHistoryJobs = pgTable(
  'agent_history_jobs',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('agentHistoryJobs'))
      .primaryKey(),

    status: text('status', { enum: ['pending', 'completed'] })
      .notNull()
      .default('pending'),

    /**
     * Job discriminator: `transfer` (scope rewrite) or `copy` (history fork).
     * Enumerated so every drain path has to acknowledge both kinds — a driver
     * that runs transfer logic over a `copy` job would delete its queue rows
     * and report success against untouched history.
     */
    type: text('type', { enum: ['transfer', 'copy'] })
      .notNull()
      .default('transfer'),

    /**
     * Type-specific job data. `transfer` jobs keep it null; `copy` jobs store
     * the source→target agent id map (`{ agents: [{ sourceAgentId, newAgentId }] }`)
     * so guards can answer "is a copy still reading this source agent?" without
     * joining the queue. The per-topic copy resolves its own coordinates from
     * the queue row's payload, not from here.
     */
    payload: jsonb('payload').$type<AgentHistoryJobPayload>(),

    /** Batch snapshot for observability; guards use the junction table below. */
    agentIds: jsonb('agent_ids').$type<string[]>().notNull(),
    /**
     * Sessions linked to the batch at transfer time. The residual step rewrites
     * topicless messages by this snapshot so late linkage changes cannot widen
     * the rewrite beyond what the synchronous half actually moved.
     */
    sessionIds: jsonb('session_ids').$type<string[]>().notNull(),
    /** Chat groups moved by a group transfer; residual linkage like sessions. */
    groupIds: jsonb('group_ids').$type<string[]>().notNull().default([]),

    sourceUserId: text('source_user_id').notNull(),
    sourceWorkspaceId: text('source_workspace_id'),
    targetUserId: text('target_user_id').notNull(),
    targetWorkspaceId: text('target_workspace_id'),

    totalTopics: integer('total_topics').notNull(),
    completedTopics: integer('completed_topics').notNull().default(0),

    completedAt: timestamptz('completed_at'),

    ...timestamps,
  },
  (t) => [
    index('agent_history_jobs_status_idx').on(t.status),
    index('agent_history_jobs_source_user_id_idx').on(t.sourceUserId),
    index('agent_history_jobs_target_user_id_idx').on(t.targetUserId),
    index('agent_history_jobs_source_workspace_id_idx').on(t.sourceWorkspaceId),
    index('agent_history_jobs_target_workspace_id_idx').on(t.targetWorkspaceId),
  ],
);

export type AgentHistoryJobItem = typeof agentHistoryJobs.$inferSelect;
export type NewAgentHistoryJob = typeof agentHistoryJobs.$inferInsert;

/**
 * Agents covered by a job. Guard queries join through here: an agent with a
 * row under a `pending` job cannot start another transfer.
 *
 * FK onto `agents` cascades on delete (deleting the agent removes the pending
 * work), but there is deliberately no unique constraint on `agent_id` alone: history
 * keeps completed jobs, and uniqueness among PENDING jobs is enforced by the
 * entry guard inside the transfer transaction.
 */
export const agentHistoryJobAgents = pgTable(
  'agent_history_job_agents',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => agentHistoryJobs.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('agent_history_job_agents_job_id_agent_id_unique').on(t.jobId, t.agentId),
    index('agent_history_job_agents_agent_id_idx').on(t.agentId),
  ],
);

export type AgentHistoryJobAgentItem = typeof agentHistoryJobAgents.$inferSelect;

/**
 * Chat groups covered by a job — the group-side twin of
 * `agent_history_job_agents`, and the only reliable handle a group has on its
 * job:
 *
 * - the progress badge polls every few seconds, and `agent_history_jobs.group_ids`
 *   is an unindexed jsonb array that completed jobs keep accumulating into;
 * - the member-agent junction is not a substitute. A group whose roster is
 *   empty registers no agent rows at all, leaving the "already migrating"
 *   guard with nothing to match on.
 *
 * Same shape rules as the agents junction: cascade on group delete (the
 * pending work dies with the group), and no unique constraint on `group_id`
 * alone — history keeps completed jobs, and single-pending-job-per-group is
 * enforced by the entry guard inside the transfer/copy transaction.
 */
export const agentHistoryJobGroups = pgTable(
  'agent_history_job_groups',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => agentHistoryJobs.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => chatGroups.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('agent_history_job_groups_job_id_group_id_unique').on(t.jobId, t.groupId),
    index('agent_history_job_groups_group_id_idx').on(t.groupId),
  ],
);

export type AgentHistoryJobGroupItem = typeof agentHistoryJobGroups.$inferSelect;

/**
 * Per-topic work queue of a job. A row means "this topic's messages (and
 * message child tables) still carry the pre-transfer scope snapshot"; the
 * worker rewrites one topic per transaction and deletes the row, so the
 * remaining rows are always exactly the un-migrated set and a crash resumes
 * idempotently.
 *
 * `priority` is the jump-the-queue bit: opening a still-pending topic flags it
 * so the worker picks it next. `activityAt` (the topic's updatedAt at enqueue
 * time) orders the default drain most-recently-active first.
 */
export const agentHistoryJobTopics = pgTable(
  'agent_history_job_topics',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => agentHistoryJobs.id, { onDelete: 'cascade' }),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),

    priority: boolean('priority').notNull().default(false),
    activityAt: timestamptz('activity_at').notNull(),

    /**
     * Type-specific queue-row data. `transfer` rows keep it null (`topic_id`
     * alone identifies the work). `copy` rows point at an already-created
     * target topic shell, so `topic_id` is the NEW topic (what status polls
     * and gray-out UI key on) and the payload records where to copy from:
     * `{ sourceTopicId, sourceAgentId, newAgentId }`.
     */
    payload: jsonb('payload').$type<AgentHistoryJobTopicPayload>(),
  },
  (t) => [
    uniqueIndex('agent_history_job_topics_job_id_topic_id_unique').on(t.jobId, t.topicId),
    index('agent_history_job_topics_topic_id_idx').on(t.topicId),
    index('agent_history_job_topics_pick_idx').on(t.jobId, t.priority, t.activityAt),
  ],
);

export type AgentHistoryJobTopicItem = typeof agentHistoryJobTopics.$inferSelect;
