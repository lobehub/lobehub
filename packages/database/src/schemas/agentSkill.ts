/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { SkillManifest, SkillResourceMeta } from '@lobechat/types';
import { relations } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { globalFiles } from './file';
import { users } from './user';

export const agentSkills = pgTable(
  'agent_skills',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('agentSkills'))
      .primaryKey(),

    // 核心标识
    name: text('name').notNull(),
    description: text('description').notNull(),
    identifier: text('identifier').notNull(),

    // 来源控制
    source: text('source', { enum: ['builtin', 'market', 'user'] }).notNull(),

    // Manifest (version, author, repository 等)
    manifest: jsonb('manifest')
      .$type<SkillManifest>()
      .notNull()
      .default({} as SkillManifest),

    // 内容与编辑器状态
    content: text('content'),
    editorData: jsonb('editor_data').$type<Record<string, any>>(),

    // 资源映射: Record<VirtualPath, SkillResourceMeta>
    resources: jsonb('resources').$type<Record<string, SkillResourceMeta>>().default({}),

    // 原始分发包 (CAS)
    zipFileHash: varchar('zip_file_hash', { length: 64 }).references(() => globalFiles.hashId, {
      onDelete: 'set null',
    }),

    // 归属
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_skills_user_name_idx').on(t.userId, t.name),
    index('agent_skills_identifier_idx').on(t.identifier),
    index('agent_skills_user_id_idx').on(t.userId),
    index('agent_skills_source_idx').on(t.source),
    index('agent_skills_zip_hash_idx').on(t.zipFileHash),
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
