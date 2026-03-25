import type { LobeAgentChatConfig, LobeAgentTTSConfig } from '@lobechat/types';
import { boolean, index, integer, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';

import { createdAt, updatedAt } from './_helpers';

export const sharedAgents = pgTable(
  'shared_agents',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .$defaultFn(() => `shared_${crypto.randomUUID()}`),

    title: varchar('title', { length: 255 }),
    description: varchar('description', { length: 1000 }),
    avatar: text('avatar'),
    backgroundColor: text('background_color'),
    tags: jsonb('tags').$type<string[]>().default([]),

    systemRole: text('system_role'),
    model: text('model'),
    provider: text('provider'),
    params: jsonb('params').default({}),
    plugins: jsonb('plugins').$type<string[]>(),
    chatConfig: jsonb('chat_config').$type<LobeAgentChatConfig>(),
    tts: jsonb('tts').$type<LobeAgentTTSConfig>(),

    openingMessage: text('opening_message'),
    openingQuestions: text('opening_questions').array().default([]),

    enabled: boolean('enabled').default(true).notNull(),
    sort: integer('sort').default(0),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('shared_agents_enabled_idx').on(t.enabled),
    index('shared_agents_sort_idx').on(t.sort),
  ],
);

export type SharedAgent = typeof sharedAgents.$inferSelect;
export type NewSharedAgent = typeof sharedAgents.$inferInsert;
