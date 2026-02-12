/* eslint-disable sort-keys-fix/sort-keys-fix  */
import type { GroundingSearch, ModelReasoning, ToolIntervention } from '@lobechat/types';
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, varchar255 } from './_helpers';
import { agents } from './agent';
import { chatGroups } from './chatGroup';
import { files } from './file';
import { chunks, embeddings } from './rag';
import { sessions } from './session';
import { threads, topics } from './topic';
import { users } from './user';

/**
 * Message groups table for multi-models parallel conversations
 * Allows multiple AI models to respond to the same user message in parallel
 */
// @ts-ignore
export const messageGroups = pgTable(
  'message_groups',
  {
    id: varchar255('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('messageGroups'))
      .notNull(),

    // Association - only needs topic level
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // Support nested structure
    // @ts-ignore
    parentGroupId: varchar255('parent_group_id').references(() => messageGroups.id, {
      onDelete: 'cascade',
    }),

    // Associated user message

    parentMessageId: text('parent_message_id').references(() => messages.id, {
      onDelete: 'cascade',
    }),

    // Metadata
    title: varchar255('title'),
    description: text('description'),

    // Compression fields
    type: text('type', { enum: ['parallel', 'compression'] }),
    content: text('content'), // compression summary (plain text)
    editorData: jsonb('editor_data'), // rich text editor data (future extension)
    metadata: jsonb('metadata'), // UI state (expanded, etc.)

    clientId: varchar255('client_id'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('message_groups_client_id_user_id_unique').on(t.clientId, t.userId),
    index('message_groups_user_id_idx').on(t.userId),
    index('message_groups_topic_id_idx').on(t.topicId),
    index('message_groups_type_idx').on(t.type),
    index('message_groups_parent_group_id_idx').on(t.parentGroupId),
    index('message_groups_parent_message_id_idx').on(t.parentMessageId),
  ],
);

export const insertMessageGroupSchema = createInsertSchema(messageGroups);

export type NewMessageGroup = typeof messageGroups.$inferInsert;
export type MessageGroupItem = typeof messageGroups.$inferSelect;

// @ts-ignore
export const messages = pgTable(
  'messages',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('messages'))
      .primaryKey(),

    role: varchar255('role').notNull(),
    content: text('content'),
    editorData: jsonb('editor_data'),
    summary: text('summary'),
    reasoning: jsonb('reasoning').$type<ModelReasoning>(),
    search: jsonb('search').$type<GroundingSearch>(),
    metadata: jsonb('metadata'),

    model: text('model'),
    provider: text('provider'),

    favorite: boolean('favorite').default(false),
    error: jsonb('error'),

    tools: jsonb('tools'),

    traceId: text('trace_id'),
    observationId: text('observation_id'),

    clientId: text('client_id'),

    // foreign keys
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /**
     * we might deprecate sessionId in the future
     */
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'cascade' }),
    // @ts-ignore
    parentId: text('parent_id').references(() => messages.id, { onDelete: 'set null' }),
    quotaId: text('quota_id').references(() => messages.id, { onDelete: 'set null' }),

    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    groupId: text('group_id').references(() => chatGroups.id, { onDelete: 'set null' }),
    // targetId can be an agent ID, "user", or null - no FK constraint
    targetId: text('target_id'),

    // used for multi-models parallel
    messageGroupId: varchar255('message_group_id').references(() => messageGroups.id, {
      onDelete: 'cascade',
    }),
    ...timestamps,
  },
  (table) => [
    index('messages_created_at_idx').on(table.createdAt),
    uniqueIndex('message_client_id_user_unique').on(table.clientId, table.userId),
    index('messages_topic_id_idx').on(table.topicId),
    index('messages_parent_id_idx').on(table.parentId),
    index('messages_quota_id_idx').on(table.quotaId),

    index('messages_user_id_idx').on(table.userId),
    index('messages_session_id_idx').on(table.sessionId),
    index('messages_thread_id_idx').on(table.threadId),
    index('messages_agent_id_idx').on(table.agentId),
    index('messages_group_id_idx').on(table.groupId),
    index('messages_message_group_id_idx').on(table.messageGroupId),
  ],
);

// if the message container a plugin
export const messagePlugins = pgTable(
  'message_plugins',
  {
    id: text('id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .primaryKey(),

    toolCallId: text('tool_call_id'),
    type: text('type').default('default'),

    // Human intervention fields
    intervention: jsonb('intervention').$type<ToolIntervention>(),
    apiName: text('api_name'),
    arguments: text('arguments'),
    identifier: text('identifier'),
    state: jsonb('state'),
    error: jsonb('error'),
    clientId: text('client_id'),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [
    uniqueIndex('message_plugins_client_id_user_id_unique').on(t.clientId, t.userId),
    index('message_plugins_user_id_idx').on(t.userId),
    index('message_plugins_tool_call_id_idx').on(t.toolCallId),
  ],
);

export const messageTTS = pgTable(
  'message_tts',
  {
    id: text('id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .primaryKey(),
    contentMd5: text('content_md5'),
    fileId: text('file_id').references(() => files.id, { onDelete: 'cascade' }),
    voice: text('voice'),
    clientId: text('client_id'),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => ({
    clientIdUnique: uniqueIndex('message_tts_client_id_user_id_unique').on(t.clientId, t.userId),
    userIdIdx: index('message_tts_user_id_idx').on(t.userId),
  }),
);

export const messageTranslates = pgTable(
  'message_translates',
  {
    id: text('id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .primaryKey(),
    content: text('content'),
    from: text('from'),
    to: text('to'),
    clientId: text('client_id'),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => ({
    clientIdUnique: uniqueIndex('message_translates_client_id_user_id_unique').on(
      t.clientId,
      t.userId,
    ),
    userIdIdx: index('message_translates_user_id_idx').on(t.userId),
  }),
);

// if the message contains a file
// save the file id and message id
export const messagesFiles = pgTable(
  'messages_files',
  {
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fileId, t.messageId] }),
    userIdIdx: index('messages_files_user_id_idx').on(t.userId),
    messageIdIdx: index('messages_files_message_id_idx').on(t.messageId),
  }),
);

export const messageQueries = pgTable(
  'message_queries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: text('message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),
    rewriteQuery: text('rewrite_query'),
    userQuery: text('user_query'),
    clientId: text('client_id'),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    embeddingsId: uuid('embeddings_id').references(() => embeddings.id, { onDelete: 'set null' }),
  },
  (t) => ({
    clientIdUnique: uniqueIndex('message_queries_client_id_user_id_unique').on(
      t.clientId,
      t.userId,
    ),
    userIdIdx: index('message_queries_user_id_idx').on(t.userId),
    messageIdIdx: index('message_queries_message_id_idx').on(t.messageId),
    embeddingsIdIdx: index('message_queries_embeddings_id_idx').on(t.embeddingsId),
  }),
);

export type NewMessageQuery = typeof messageQueries.$inferInsert;

export const messageQueryChunks = pgTable(
  'message_query_chunks',
  {
    messageId: text('id').references(() => messages.id, { onDelete: 'cascade' }),
    queryId: uuid('query_id').references(() => messageQueries.id, { onDelete: 'cascade' }),
    chunkId: uuid('chunk_id').references(() => chunks.id, { onDelete: 'cascade' }),
    similarity: numeric('similarity', { precision: 6, scale: 5 }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chunkId, t.messageId, t.queryId] }),
    userIdIdx: index('message_query_chunks_user_id_idx').on(t.userId),
    messageIdIdx: index('message_query_chunks_message_id_idx').on(t.messageId),
    queryIdIdx: index('message_query_chunks_query_id_idx').on(t.queryId),
  }),
);
export type NewMessageFileChunk = typeof messageQueryChunks.$inferInsert;

// convert message content to the chunks
// then we can use message as the RAG source
export const messageChunks = pgTable(
  'message_chunks',
  {
    messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    chunkId: uuid('chunk_id').references(() => chunks.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chunkId, t.messageId] }),
    userIdIdx: index('message_chunks_user_id_idx').on(t.userId),
    messageIdIdx: index('message_chunks_message_id_idx').on(t.messageId),
  }),
);
