import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { amountNumeric, timestamps, timestamptz } from './_helpers';
import { topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * One classification of a topic per taxonomy version, written after the topic's
 * auto summary. Re-analyzing the same topic under the same version replaces the
 * row; a new taxonomy version adds a row so earlier results stay comparable.
 */
export const topicAnalyses = pgTable(
  'topic_analyses',
  {
    // Only read in bulk for reporting, never linked, so no id prefix.
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    topicId: text('topic_id')
      .references(() => topics.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    taxonomyVersion: text('taxonomy_version').notNull(),
    category: text('category').notNull(),
    secondaryCategory: text('secondary_category'),
    intent: text('intent'),
    outcome: text('outcome'),
    labels: jsonb('labels').$type<Record<string, unknown>>(),

    /** Model and provider that produced this analysis. */
    model: text('model'),
    provider: text('provider'),

    // ---- The topic's own consumption when it was analyzed ----
    // A snapshot, not a join: reports group cost and effort by category without
    // the topic's running totals drifting after the analysis. NULL = not measured.
    topicModel: text('topic_model'),
    topicProvider: text('topic_provider'),
    totalTokens: integer('total_tokens'),
    totalInputTokens: integer('total_input_tokens'),
    totalOutputTokens: integer('total_output_tokens'),
    totalCost: amountNumeric('total_cost'),
    llmCalls: integer('llm_calls'),
    toolCalls: integer('tool_calls'),
    userMessages: integer('user_messages'),
    assistantMessages: integer('assistant_messages'),

    /** Newest message the analysis saw; a later message means the result is out of date. */
    lastMessageId: text('last_message_id'),
    lastMessageUpdatedAt: timestamptz('last_message_updated_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('topic_analyses_topic_version_unique').on(t.topicId, t.taxonomyVersion),
    index('topic_analyses_user_id_created_at_idx').on(t.userId, t.createdAt),
    index('topic_analyses_workspace_id_created_at_idx')
      .on(t.workspaceId, t.createdAt)
      .where(sql`${t.workspaceId} IS NOT NULL`),
    index('topic_analyses_version_category_idx').on(t.taxonomyVersion, t.category),
  ],
);

export type TopicAnalysisItem = typeof topicAnalyses.$inferSelect;
export type NewTopicAnalysis = typeof topicAnalyses.$inferInsert;
