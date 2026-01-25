/* eslint-disable sort-keys-fix/sort-keys-fix  */
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

import type { ChatGroupConfig } from '../types/chatGroup';
import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { agents } from './agent';
import { sessionGroups } from './session';
import { users } from './user';

/**
 * Chat groups table for multi-agent conversations
 * Allows multiple agents to participate in a single chat session
 */
export const chatGroups = pgTable(
  'chat_groups',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('chatGroups'))
      .notNull(),
    title: text('title'),
    description: text('description'),
    avatar: text('avatar'),
    backgroundColor: text('background_color'),
    marketIdentifier: text('market_identifier'),
    content: text('content'),
    editorData: jsonb('editor_data').$type<Record<string, any>>(),

    config: jsonb('config').$type<ChatGroupConfig>(),

    clientId: text('client_id'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    groupId: text('group_id').references(() => sessionGroups.id, { onDelete: 'set null' }),

    pinned: boolean('pinned').default(false),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('chat_groups_client_id_user_id_unique').on(t.clientId, t.userId),
    index('chat_groups_user_id_idx').on(t.userId),
    index('chat_groups_group_id_idx').on(t.groupId),
  ],
);

export type NewChatGroup = typeof chatGroups.$inferInsert;
export type ChatGroupItem = typeof chatGroups.$inferSelect;

/**
 * Junction table connecting chat groups with agents
 * Defines which agents participate in each group chat
 */
export const chatGroupsAgents = pgTable(
  'chat_groups_agents',
  {
    chatGroupId: text('chat_group_id')
      .references(() => chatGroups.id, { onDelete: 'cascade' })
      .notNull(),
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /**
     * Whether this agent is active in the group
     */
    enabled: boolean('enabled').default(true),

    /**
     * Display or speaking order of the agent in the group
     */
    order: integer('order').default(0),

    /**
     * Role of the agent in the group (e.g., 'moderator', 'participant')
     */
    role: text('role').default('participant'),

    ...timestamps,
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chatGroupId, t.agentId] }),
    userIdIdx: index('chat_groups_agents_user_id_idx').on(t.userId),
  }),
);

export type NewChatGroupAgent = typeof chatGroupsAgents.$inferInsert;
export type ChatGroupAgentItem = typeof chatGroupsAgents.$inferSelect;
