import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './user';

export const audioGenerations = pgTable(
  'audio_generations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    prompt: text('prompt').notNull(),
    musicStyle: text('music_style').notNull(),
    duration: integer('duration').notNull(),
    modelVersion: text('model_version').default('v5.5').notNull(),
    taskId: text('task_id').notNull().unique(),
    status: text('status').default('pending').notNull(),
    audioUrl: text('audio_url'),
    audioMetadata: jsonb('audio_metadata').$type<{
      title?: string;
      duration?: number;
      imageLargeUrl?: string;
      imageUrl?: string;
      lyricUrl?: string;
    }>(),
    error: text('error'),
    ...timestamps,
  },
  (t) => [
    index('audio_generations_user_id_idx').on(t.userId),
    index('audio_generations_status_idx').on(t.status),
    index('audio_generations_created_at_idx').on(t.createdAt),
    index('audio_generations_task_id_idx').on(t.taskId),
  ],
);

export type NewAudioGenerationItem = typeof audioGenerations.$inferInsert;
export type AudioGenerationSelectItem = typeof audioGenerations.$inferSelect;
