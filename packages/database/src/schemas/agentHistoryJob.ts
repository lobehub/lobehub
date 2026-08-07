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
import { topics } from './topic';

/**
 * Async bulk jobs over an agent's conversation history.
 *
 * Tables are named generically (`agent_history_jobs`) with a `type`
 * discriminator because the per-topic queue shape is reusable beyond scope
 * transfer — e.g. a future async "copy with history". Today `transfer` is the
 * only kind; the business layer keeps transfer-specific naming until a second
 * kind actually lands.
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

    /** Job discriminator; only `transfer` exists today (see header doc). */
    type: text('type').notNull().default('transfer'),

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
  },
  (t) => [
    uniqueIndex('agent_history_job_topics_job_id_topic_id_unique').on(t.jobId, t.topicId),
    index('agent_history_job_topics_topic_id_idx').on(t.topicId),
    index('agent_history_job_topics_pick_idx').on(t.jobId, t.priority, t.activityAt),
  ],
);

export type AgentHistoryJobTopicItem = typeof agentHistoryJobTopics.$inferSelect;
