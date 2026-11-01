import type {
  UserMemoryEntityNameKind,
  UserMemoryEntityType,
  UserMemoryVisibility,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../../utils/idGenerator';
import { timestamps, varchar255 } from '../_helpers';
import { agents } from '../agent';
import { projects } from '../project';
import { users } from '../user';
import { workspaces } from '../workspace';
import { userMemories } from './base';

/**
 * A person, organization, product, repository or place the user deals with. The user is the
 * entity with `is_self`. Names, facts (identities) and preferences hang off entities. Like every
 * other memory it has a parent row in `user_memories`, so it is a node in `user_memories_edges`
 * (mentions, "not the same as", …).
 */
export const userMemoriesEntities = pgTable(
  'user_memories_entities',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('memory'))
      .primaryKey(),
    /** e.g. a fund under its firm, a subsidiary under its group. */
    parentEntityId: varchar255('parent_entity_id').references(
      (): AnyPgColumn => userMemoriesEntities.id,
      { onDelete: 'set null' },
    ),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Owning agent when this is the agent's own memory; null for the user's personal memory. */
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    /** Owning project (1:1). Many-to-many relevance to projects lives in `user_memories_context_projects`. */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    userMemoryId: varchar255('user_memory_id').references(() => userMemories.id, {
      onDelete: 'cascade',
    }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    /** Canonical name; other names live in `user_memories_entity_names`. */
    name: text('name').notNull(),
    type: text('type').$type<UserMemoryEntityType>().notNull().default('other'),
    relationship: text('relationship'),
    role: text('role'),
    description: text('description'),
    descriptionVector: vector('description_vector', { dimensions: 1024 }),
    isSelf: boolean('is_self').notNull().default(false),

    /** Workspace visibility: personal memory stays `private`; agent / project memory may be `public`. */
    visibility: text('visibility').$type<UserMemoryVisibility>().notNull().default('private'),

    ...timestamps,
  },
  (table) => [
    index('user_memories_entities_description_vector_index').using(
      'hnsw',
      table.descriptionVector.op('vector_cosine_ops'),
    ),
    index('user_memories_entities_user_id_index').on(table.userId),
    index('user_memories_entities_parent_entity_id_index').on(table.parentEntityId),
    index('user_memories_entities_user_memory_id_index').on(table.userMemoryId),
    uniqueIndex('user_memories_entities_user_id_self_unique')
      .on(table.userId)
      .where(sql`${table.isSelf}`),
    index('user_memories_entities_workspace_visibility_idx').on(
      table.workspaceId,
      table.visibility,
      table.userId,
    ),
    index('user_memories_entities_agent_id_index').on(table.agentId),
    index('user_memories_entities_project_id_index').on(table.projectId),
  ],
);

/** Every name an entity goes by, including old names and names the user corrected away from. */
export const userMemoriesEntityNames = pgTable(
  'user_memories_entity_names',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    entityId: varchar255('entity_id')
      .references(() => userMemoriesEntities.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    name: text('name').notNull(),
    /** Lower-cased, whitespace-collapsed form used for exact resolution. */
    normalized: text('normalized').notNull(),
    kind: text('kind').$type<UserMemoryEntityNameKind>().notNull().default('alias'),
    /** The memory that stated this name. */
    sourceMemoryId: varchar255('source_memory_id').references(() => userMemories.id, {
      onDelete: 'set null',
    }),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('user_memories_entity_names_entity_id_normalized_unique').on(
      table.entityId,
      table.normalized,
    ),
    index('user_memories_entity_names_user_id_normalized_index').on(table.userId, table.normalized),
    index('user_memories_entity_names_workspace_id_normalized_index').on(
      table.workspaceId,
      table.normalized,
    ),
  ],
);
