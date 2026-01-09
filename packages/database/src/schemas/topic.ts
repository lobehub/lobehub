/* eslint-disable sort-keys-fix/sort-keys-fix  */
import type { ChatTopicMetadata, ThreadMetadata } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { chatGroups } from './chatGroup';
import { documents } from './file';
import { sessions } from './session';
import { users } from './user';

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
    historySummary: text('history_summary'),
    metadata: jsonb('metadata').$type<ChatTopicMetadata | undefined>(),
    trigger: text('trigger'), // 'cron' | 'chat' | 'api' - topic creation trigger source
    mode: text('mode'), // 'temp' | 'test' | 'default' - topic usage scenario
    ...timestamps,
  },
  (t) => [
    uniqueIndex('topics_client_id_user_id_unique').on(t.clientId, t.userId),
    index('topics_user_id_idx').on(t.userId),
    index('topics_id_user_id_idx').on(t.id, t.userId),
    index('topics_session_id_idx').on(t.sessionId),
    index('topics_group_id_idx').on(t.groupId),
    index('topics_agent_id_idx').on(t.agentId),
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
    type: text('type', { enum: ['continuation', 'standalone', 'isolation'] }).notNull(),
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
    ...timestamps,
  },
  (t) => [
    uniqueIndex('threads_client_id_user_id_unique').on(t.clientId, t.userId),
    index('threads_topic_id_idx').on(t.topicId),
    index('threads_agent_id_idx').on(t.agentId),
    index('threads_group_id_idx').on(t.groupId),
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

    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.topicId] })],
);

export type NewTopicDocument = typeof topicDocuments.$inferInsert;
export type TopicDocumentItem = typeof topicDocuments.$inferSelect;
