import { boolean, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { agents } from './agent';
import { files, knowledgeBases } from './file';
import { users } from './user';
import { workspaces } from './workspace';

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
