import type { EvalMemoryLayer, EvalMemorySource } from '@lobechat/types';
import { index, jsonb, pgTable, text, uuid, vector } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { agentEvalRuns } from './agentEvals';
import { threads, topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * The Memory of one eval attempt (a run's topic, or one pass@k thread of it):
 * the case fixture seeded at the start plus whatever the Agent wrote. The
 * Memory tool of an attempt reads and writes only these rows, so attempts
 * never see each other and never touch the caller's own memories. Rows are
 * evidence: they stay until their run or owner is deleted. Conversation deletion
 * clears topic/thread pointers; attemptId preserves the original attempt identity.
 */
export const agentEvalMemories = pgTable(
  'agent_eval_memories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** The run's workspace; null for a personal run. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .references(() => agentEvalRuns.id, { onDelete: 'cascade' })
      .notNull(),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    /** `runId_topicId[_threadId]`: the key the mock service also groups by. */
    attemptId: text('attempt_id').notNull(),

    layer: text('layer').$type<EvalMemoryLayer>().notNull(),
    source: text('source').$type<EvalMemorySource>().notNull(),
    /** Set on seeded rows: a resumed attempt must bring the same fixture. */
    fixtureHash: text('fixture_hash'),

    title: text('title'),
    summary: text('summary'),
    details: text('details'),
    memoryCategory: text('memory_category'),
    memoryType: text('memory_type'),
    tags: jsonb('tags').$type<string[]>(),
    /** The layer-specific part of the entry, as the Memory tool received it. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    embedding: vector('embedding', { dimensions: 1024 }),

    /** The fixture's seededAt for seeded rows; the wall clock for the Agent's writes. */
    capturedAt: timestamptz('captured_at').notNull(),
    /** The Agent removed the entry (identities); kept as evidence, hidden from search. */
    removedReason: text('removed_reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [
    index('agent_eval_memories_attempt_id_idx').on(t.attemptId),
    index('agent_eval_memories_run_id_idx').on(t.runId),
    index('agent_eval_memories_topic_id_idx').on(t.topicId),
    index('agent_eval_memories_thread_id_idx').on(t.threadId),
    index('agent_eval_memories_user_id_idx').on(t.userId),
    index('agent_eval_memories_workspace_id_idx').on(t.workspaceId),
  ],
);

export type AgentEvalMemoryItem = typeof agentEvalMemories.$inferSelect;
export type NewAgentEvalMemory = typeof agentEvalMemories.$inferInsert;
