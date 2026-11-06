import type { ArtboardContent, ArtboardPhase } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { projects } from './project';
import { tasks } from './task';
import { topics } from './topic';
import { users } from './user';
import { acceptances } from './verify';
import { workspaces } from './workspace';

export const artboards = pgTable(
  'artboards',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('artboards'))
      .notNull(),
    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    acceptanceId: uuid('acceptance_id').references(() => acceptances.id, {
      onDelete: 'set null',
    }),
    originTopicId: text('origin_topic_id').references(() => topics.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    phase: text('phase').$type<ArtboardPhase>().notNull().default('discuss'),
    content: jsonb('content').$type<ArtboardContent>().notNull(),
    revision: integer('revision').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('artboards_task_id_unique').on(t.taskId),
    index('artboards_project_id_idx').on(t.projectId),
    index('artboards_user_id_idx').on(t.userId),
    index('artboards_workspace_id_idx')
      .on(t.workspaceId)
      .where(sql`${t.workspaceId} IS NOT NULL`),
  ],
);

export type ArtboardRow = typeof artboards.$inferSelect;
export type NewArtboardRow = typeof artboards.$inferInsert;
