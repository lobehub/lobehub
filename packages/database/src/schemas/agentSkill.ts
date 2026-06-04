import type { SkillManifest, SkillResourceMeta } from '@lobechat/types';
import { isNotNull, isNull, relations } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { globalFiles } from './file';
import { users } from './user';
import { workspaces } from './workspace';

export const agentSkills = pgTable(
  'agent_skills',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('agentSkills'))
      .primaryKey(),

    // Core identifiers
    name: text('name').notNull(),
    description: text('description').notNull(),
    identifier: text('identifier').notNull(),

    // Source control
    source: text('source', { enum: ['builtin', 'market', 'user'] }).notNull(),

    // Manifest (version, author, repository, etc.)
    manifest: jsonb('manifest')
      .$type<SkillManifest>()
      .notNull()
      .default({} as SkillManifest),

    // Content and editor state
    content: text('content'),
    editorData: jsonb('editor_data').$type<Record<string, any>>(),

    // Resource mapping: Record<VirtualPath, SkillResourceMeta>
    resources: jsonb('resources').$type<Record<string, SkillResourceMeta>>().default({}),

    // Raw distribution package (CAS)
    zipFileHash: varchar('zip_file_hash', { length: 64 }).references(() => globalFiles.hashId, {
      onDelete: 'set null',
    }),

    // Ownership
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_skills_user_name_idx').on(t.userId, t.name).where(isNull(t.workspaceId)),
    index('agent_skills_identifier_idx').on(t.identifier),
    index('agent_skills_user_id_idx').on(t.userId),
    index('agent_skills_source_idx').on(t.source),
    index('agent_skills_zip_hash_idx').on(t.zipFileHash),
    index('agent_skills_workspace_id_idx').on(t.workspaceId),
    uniqueIndex('agent_skills_name_workspace_id_unique')
      .on(t.workspaceId, t.name)
      .where(isNotNull(t.workspaceId)),
  ],
);

export const agentSkillsRelations = relations(agentSkills, ({ one }) => ({
  user: one(users, {
    fields: [agentSkills.userId],
    references: [users.id],
  }),
  zipFile: one(globalFiles, {
    fields: [agentSkills.zipFileHash],
    references: [globalFiles.hashId],
  }),
}));

export type NewAgentSkill = typeof agentSkills.$inferInsert;
