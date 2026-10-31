import type { EvalMemoryLayer } from '@lobechat/types';
import { index, jsonb, pgTable, text, vector } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz } from './_helpers';
import { agentEvalRuns } from './agentEvals';
import { threads, topics } from './topic';
import { users } from './user';

export const evalMemoryLayers = [
  'activity',
  'context',
  'experience',
  'identity',
  'persona',
  'preference',
] as const satisfies readonly EvalMemoryLayer[];

/**
 * The Memory of one eval attempt (a run's topic, or one pass@k thread of it):
 * the case fixture seeded at the start plus whatever the Agent wrote. The
 * Memory tool of an attempt reads and writes only these rows, so attempts
 * never see each other and never touch the caller's own memories. Rows are
 * evidence: they stay until their run is deleted.
 */
export const agentEvalMemories = pgTable(
  'agent_eval_memories',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('evalMemories'))
      .primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    runId: text('run_id')
      .references(() => agentEvalRuns.id, { onDelete: 'cascade' })
      .notNull(),
    topicId: text('topic_id')
      .references(() => topics.id, { onDelete: 'cascade' })
      .notNull(),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'cascade' }),
    /** `runId_topicId[_threadId]`: the key the mock service also groups by. */
    attemptId: text('attempt_id').notNull(),

    layer: text('layer', { enum: evalMemoryLayers }).notNull(),
    source: text('source', { enum: ['agent', 'fixture'] }).notNull(),
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
    ...timestamps,
  },
  (t) => [
    index('agent_eval_memories_attempt_id_idx').on(t.attemptId),
    index('agent_eval_memories_run_id_idx').on(t.runId),
    index('agent_eval_memories_user_id_idx').on(t.userId),
  ],
);

export type AgentEvalMemoryItem = typeof agentEvalMemories.$inferSelect;
export type NewAgentEvalMemory = typeof agentEvalMemories.$inferInsert;
