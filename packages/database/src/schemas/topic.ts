import type { ChatTopicMetadata, ThreadMetadata } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { createNanoId, idGenerator } from '../utils/idGenerator';
import { amountNumeric, createdAt, timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { chatGroups } from './chatGroup';
import { documents } from './file';
import { sessions } from './session';
import { users } from './user';
import { workspaces } from './workspace';

export const topics = pgTable(
  'topics',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('topics'))
      .primaryKey(),
    title: text('title'),
    favorite: boolean('favorite').default(false),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
    content: text('content'),
    editorData: jsonb('editor_data'),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    groupId: text('group_id').references(() => chatGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: text('client_id'),
    description: text('description'),
    historySummary: text('history_summary'),
    metadata: jsonb('metadata').$type<ChatTopicMetadata | undefined>(),
    trigger: text('trigger'), // 'cron' | 'chat' | 'api' | 'eval' | 'share' - topic creation trigger source
    mode: text('mode'), // 'temp' | 'test' | 'default' - topic usage scenario
    status: text('status', {
      enum: ['active', 'running', 'paused', 'waitingForHuman', 'failed', 'completed', 'archived'],
    }),
    completedAt: timestamptz('completed_at'),

    // ---- Usage & cost aggregates (denormalized roll-up of the topic's operations) ----
    // Kept nullable: NULL means "not measured yet" so in-flight / legacy topics
    // don't pollute SUM/AVG aggregates as if they were $0 / 0-token topics.
    totalCost: amountNumeric('total_cost'),
    totalInputTokens: integer('total_input_tokens'),
    totalOutputTokens: integer('total_output_tokens'),
    totalTokens: integer('total_tokens'),
    // Full per-model cost / usage breakdowns for slice-and-dice analytics.
    cost: jsonb('cost').$type<Record<string, unknown>>(),
    usage: jsonb('usage').$type<Record<string, unknown>>(),
    // Primary model / provider snapshot, promoted from metadata so it is indexable for GROUP BY.
    model: text('model'),
    provider: text('provider'),

    /**
     * Visitor identity for agent-share originated topics.
     * Unauthenticated: browser-generated UUID stored in localStorage.
     * After login: overwritten with the user's actual userId by the application layer.
     * NULL for regular (non-share) conversations.
     */
    senderId: text('sender_id'),

    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('topics_client_id_user_id_unique').on(t.clientId, t.userId),
    index('topics_user_id_idx').on(t.userId),
    index('topics_id_user_id_idx').on(t.id, t.userId),
    index('topics_session_id_idx').on(t.sessionId),
    index('topics_group_id_idx').on(t.groupId),
    index('topics_agent_id_idx').on(t.agentId),
    index('topics_trigger_idx').on(t.trigger),
    index('topics_status_idx').on(t.status),
    index('topics_model_idx').on(t.model),
    index('topics_provider_idx').on(t.provider),
    index('topics_user_id_completed_at_idx').on(t.userId, t.completedAt),
    index('topics_sender_id_idx').on(t.senderId),
    index('topics_workspace_id_idx').on(t.workspaceId),
    index('topics_extract_status_gin_idx').using(
      'gin',
      sql`(metadata->'userMemoryExtractStatus') jsonb_path_ops`,
    ),
  ],
);

export type NewTopic = typeof topics.$inferInsert;
export type TopicItem = typeof topics.$inferSelect;

// @ts-ignore
export const threads = pgTable(
  'threads',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('threads', 16))
      .primaryKey(),

    title: text('title'),
    content: text('content'),
    editor_data: jsonb('editor_data'),
    type: text('type', { enum: ['continuation', 'standalone', 'isolation', 'eval'] }).notNull(),
    status: text('status', {
      enum: [
        'active',
        'processing',
        'pending',
        'inReview',
        'todo',
        'cancel',
        'completed',
        'failed',
      ],
    }),

    topicId: text('topic_id')
      .references(() => topics.id, { onDelete: 'cascade' })
      .notNull(),
    sourceMessageId: text('source_message_id'),
    // @ts-ignore
    parentThreadId: text('parent_thread_id').references(() => threads.id, { onDelete: 'set null' }),
    clientId: text('client_id'),

    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    groupId: text('group_id').references(() => chatGroups.id, { onDelete: 'cascade' }),
    metadata: jsonb('metadata').$type<ThreadMetadata | undefined>(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    lastActiveAt: timestamptz('last_active_at').defaultNow(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('threads_client_id_user_id_unique').on(t.clientId, t.userId),
    index('threads_user_id_idx').on(t.userId),
    index('threads_topic_id_idx').on(t.topicId),
    index('threads_type_idx').on(t.type),
    index('threads_agent_id_idx').on(t.agentId),
    index('threads_group_id_idx').on(t.groupId),
    index('threads_parent_thread_id_idx').on(t.parentThreadId),
    index('threads_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewThread = typeof threads.$inferInsert;
export type ThreadItem = typeof threads.$inferSelect;
export const insertThreadSchema = createInsertSchema(threads);

/**
 * Document-Topic association table - Implements many-to-many relationship between documents and topics
 */
export const topicDocuments = pgTable(
  'topic_documents',
  {
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),

    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.topicId] }),
    index('topic_documents_user_id_idx').on(t.userId),
    index('topic_documents_topic_id_idx').on(t.topicId),
    index('topic_documents_document_id_idx').on(t.documentId),
    index('topic_documents_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewTopicDocument = typeof topicDocuments.$inferInsert;
export type TopicDocumentItem = typeof topicDocuments.$inferSelect;

/**
 * Topic sharing table - Manages public sharing links for topics
 */
export const topicShares = pgTable(
  'topic_shares',
  {
    id: text('id')
      .$defaultFn(() => createNanoId(8)())
      .primaryKey(),

    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    visibility: text('visibility').default('private').notNull(), // 'private' | 'link'

    pageViewCount: integer('page_view_count').default(0).notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('topic_shares_topic_id_unique').on(t.topicId),
    index('topic_shares_user_id_idx').on(t.userId),
    index('topic_shares_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewTopicShare = typeof topicShares.$inferInsert;
export type TopicShareItem = typeof topicShares.$inferSelect;
