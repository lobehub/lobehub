import type {
  LobeAgentAgencyConfig,
  LobeAgentChatConfig,
  LobeAgentTTSConfig,
} from '@lobechat/types';
import { AgentChatConfigSchema } from '@lobechat/types';
import { sql } from 'drizzle-orm';
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
import { z } from 'zod';

import { idGenerator, randomSlug } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { files, knowledgeBases } from './file';
import { sessionGroups } from './session';
import { users } from './user';
import { workspaces } from './workspace';

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
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    agencyConfig: jsonb('agency_config').$type<LobeAgentAgencyConfig>(),
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
    // Personal mode: per-user unique slug (workspace_id IS NULL). Workspace
    // mode is covered by `agents_slug_workspace_id_unique` below — without the
    // `workspace_id IS NULL` partition here, a user's personal `slug='inbox'`
    // would block creating workspace-scoped inboxes (slug='inbox' is unique
    // per builtin agent, and `getBuiltinAgent` would hit a duplicate-key
    // error and silently return null).
    uniqueIndex('agents_slug_user_id_unique')
      .on(t.slug, t.userId)
      .where(sql`${t.workspaceId} IS NULL`),
    // Team workspace: slug unique within a workspace.
    uniqueIndex('agents_slug_workspace_id_unique')
      .on(t.workspaceId, t.slug)
      .where(sql`${t.workspaceId} IS NOT NULL`),
    index('agents_user_id_idx').on(t.userId),
    index('agents_title_idx').on(t.title),
    index('agents_description_idx').on(t.description),
    index('agents_session_group_id_idx').on(t.sessionGroupId),
    index('agents_workspace_id_idx').on(t.workspaceId),
  ],
);

/** @deprecated Use CreateAgentSchema from @lobechat/types instead */
export const insertAgentSchema = createInsertSchema(agents, {
  agencyConfig: z.custom<LobeAgentAgencyConfig>().nullable().optional(),
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
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').default(true),

    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.knowledgeBaseId] }),
    index('agents_knowledge_bases_agent_id_idx').on(t.agentId),
    index('agents_knowledge_bases_knowledge_base_id_idx').on(t.knowledgeBaseId),
    index('agents_knowledge_bases_user_id_idx').on(t.userId),
    index('agents_knowledge_bases_workspace_id_idx').on(t.workspaceId),
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
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.fileId, t.agentId, t.userId] }),
    index('agents_files_agent_id_idx').on(t.agentId),
    index('agents_files_file_id_idx').on(t.fileId),
    index('agents_files_user_id_idx').on(t.userId),
    index('agents_files_workspace_id_idx').on(t.workspaceId),
  ],
);
