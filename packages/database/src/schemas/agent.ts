/* eslint-disable sort-keys-fix/sort-keys-fix  */
import type { LobeAgentChatConfig, LobeAgentTTSConfig } from '@lobechat/types';
import { AgentChatConfigSchema } from '@lobechat/types';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator, randomSlug } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { files, knowledgeBases } from './file';
import { sessionGroups } from './session';
import { users } from './user';

// Agent table is the main table for storing agents
// agent is a model that represents the assistant that is created by the user
// agent can have its own knowledge base and files

export const agents = pgTable(
  'agents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('agents'))
      .notNull(),
    slug: varchar('slug', { length: 100 }).$defaultFn(() => randomSlug(3)),
    title: varchar('title', { length: 255 }),
    description: varchar('description', { length: 1000 }),
    tags: jsonb('tags').$type<string[]>().default([]),
    editorData: jsonb('editor_data'),
    avatar: text('avatar'),
    backgroundColor: text('background_color'),
    marketIdentifier: text('market_identifier'),

    plugins: jsonb('plugins').$type<string[]>(),

    clientId: text('client_id'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    chatConfig: jsonb('chat_config').$type<LobeAgentChatConfig>(),

    fewShots: jsonb('few_shots'),
    model: text('model'),
    params: jsonb('params').default({}),
    provider: text('provider'),
    systemRole: text('system_role'),
    tts: jsonb('tts').$type<LobeAgentTTSConfig>(),

    virtual: boolean('virtual').default(false),
    pinned: boolean('pinned'),

    openingMessage: text('opening_message'),
    openingQuestions: text('opening_questions').array().default([]),

    sessionGroupId: text('session_group_id').references(() => sessionGroups.id, {
      onDelete: 'set null',
    }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('client_id_user_id_unique').on(t.clientId, t.userId),
    uniqueIndex('agents_slug_user_id_unique').on(t.slug, t.userId),
    index('agents_user_id_idx').on(t.userId),
    index('agents_title_idx').on(t.title),
    index('agents_description_idx').on(t.description),
    index('agents_session_group_id_idx').on(t.sessionGroupId),
  ],
);

export const insertAgentSchema = createInsertSchema(agents, {
  // Override chatConfig type to use the proper schema
  chatConfig: AgentChatConfigSchema.nullable().optional(),
});

export type NewAgent = typeof agents.$inferInsert;
export type AgentItem = typeof agents.$inferSelect;

export const agentsKnowledgeBases = pgTable(
  'agents_knowledge_bases',
  {
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    knowledgeBaseId: text('knowledge_base_id')
      .references(() => knowledgeBases.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    enabled: boolean('enabled').default(true),

    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.knowledgeBaseId] }),
    index('agents_knowledge_bases_agent_id_idx').on(t.agentId),
    index('agents_knowledge_bases_knowledge_base_id_idx').on(t.knowledgeBaseId),
    index('agents_knowledge_bases_user_id_idx').on(t.userId),
  ],
);

export const agentsFiles = pgTable(
  'agents_files',
  {
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').default(true),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.fileId, t.agentId, t.userId] }),
    index('agents_files_agent_id_idx').on(t.agentId),
    index('agents_files_file_id_idx').on(t.fileId),
    index('agents_files_user_id_idx').on(t.userId),
  ],
);
