import type {
  ArtboardBoardMetadata,
  ArtboardBoardType,
  ArtboardCommentAnchor,
  ArtboardCommentMetadata,
  ArtboardEdgeMetadata,
  ArtboardGroupKind,
  ArtboardGroupMetadata,
  ArtboardMetadata,
  ArtboardPageMetadata,
  ArtboardPhase,
  ArtboardRect,
  ArtboardRoundMetadata,
  ArtboardRoundStatus,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { files } from './file';
import { projects } from './project';
import { tasks } from './task';
import { topics } from './topic';
import { users } from './user';
import { acceptances } from './verify';
import { workVersions } from './work';
import { workspaces } from './workspace';

const ownerColumns = {
  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
};

const artboardRef = () =>
  text('artboard_id')
    .references(() => artboards.id, { onDelete: 'cascade' })
    .notNull();

export const artboards = pgTable(
  'artboards',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('artboards'))
      .notNull(),
    ...ownerColumns,
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    acceptanceId: uuid('acceptance_id').references(() => acceptances.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description'),
    content: text('content'),
    phase: text('phase').$type<ArtboardPhase>().notNull().default('discuss'),
    // Bumped only by canvas-structure writes; comments and choices leave it alone.
    revision: integer('revision').notNull().default(1),
    metadata: jsonb('metadata').$type<ArtboardMetadata>(),
    ...timestamps,
  },
  (t) => [
    index('artboards_user_id_idx').on(t.userId),
    index('artboards_workspace_id_idx')
      .on(t.workspaceId)
      .where(sql`${t.workspaceId} IS NOT NULL`),
    index('artboards_topic_id_idx')
      .on(t.topicId)
      .where(sql`${t.topicId} IS NOT NULL`),
    index('artboards_task_id_idx')
      .on(t.taskId)
      .where(sql`${t.taskId} IS NOT NULL`),
    index('artboards_project_id_idx').on(t.projectId),
    index('artboards_phase_idx').on(t.phase),
    index('artboards_created_at_idx').on(t.createdAt),
    index('artboards_updated_at_idx').on(t.updatedAt),
  ],
);

export const artboardPages = pgTable(
  'artboard_pages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('artboardPages'))
      .notNull(),
    artboardId: artboardRef(),
    ...ownerColumns,
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    metadata: jsonb('metadata').$type<ArtboardPageMetadata>(),
    ...timestamps,
  },
  (t) => [
    index('artboard_pages_artboard_id_idx').on(t.artboardId),
    index('artboard_pages_user_id_idx').on(t.userId),
    index('artboard_pages_workspace_id_idx')
      .on(t.workspaceId)
      .where(sql`${t.workspaceId} IS NOT NULL`),
  ],
);

export const artboardRounds = pgTable(
  'artboard_rounds',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    artboardId: artboardRef(),
    pageId: text('page_id')
      .references(() => artboardPages.id)
      .notNull(),
    ...ownerColumns,
    title: text('title').notNull(),
    status: text('status').$type<ArtboardRoundStatus>().notNull().default('open'),
    recommendedBoardId: uuid('recommended_board_id').references(
      (): AnyPgColumn => artboardBoards.id,
      { onDelete: 'set null' },
    ),
    // A draft while the round is open; it takes effect when the round is submitted.
    chosenBoardId: uuid('chosen_board_id').references((): AnyPgColumn => artboardBoards.id, {
      onDelete: 'set null',
    }),
    selectedBy: text('selected_by').references(() => users.id, { onDelete: 'set null' }),
    selectedAt: timestamptz('selected_at'),
    metadata: jsonb('metadata').$type<ArtboardRoundMetadata>(),
    ...timestamps,
  },
  (t) => [
    index('artboard_rounds_artboard_id_idx').on(t.artboardId),
    index('artboard_rounds_page_id_idx').on(t.pageId),
    index('artboard_rounds_user_id_idx').on(t.userId),
    index('artboard_rounds_workspace_id_idx')
      .on(t.workspaceId)
      .where(sql`${t.workspaceId} IS NOT NULL`),
    index('artboard_rounds_recommended_board_id_idx')
      .on(t.recommendedBoardId)
      .where(sql`${t.recommendedBoardId} IS NOT NULL`),
    index('artboard_rounds_chosen_board_id_idx')
      .on(t.chosenBoardId)
      .where(sql`${t.chosenBoardId} IS NOT NULL`),
  ],
);

export const artboardGroups = pgTable(
  'artboard_groups',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('artboardGroups'))
      .notNull(),
    artboardId: artboardRef(),
    pageId: text('page_id')
      .references(() => artboardPages.id)
      .notNull(),
    ...ownerColumns,
    kind: text('kind').$type<ArtboardGroupKind>().notNull(),
    title: text('title').notNull(),
    description: text('description'),
    rect: jsonb('rect').$type<ArtboardRect>().notNull(),
    metadata: jsonb('metadata').$type<ArtboardGroupMetadata>(),
    ...timestamps,
  },
  (t) => [
    index('artboard_groups_artboard_id_idx').on(t.artboardId),
    index('artboard_groups_page_id_idx').on(t.pageId),
    index('artboard_groups_user_id_idx').on(t.userId),
    index('artboard_groups_workspace_id_idx')
      .on(t.workspaceId)
      .where(sql`${t.workspaceId} IS NOT NULL`),
  ],
);

export const artboardBoards = pgTable(
  'artboard_boards',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    artboardId: artboardRef(),
    pageId: text('page_id')
      .references(() => artboardPages.id)
      .notNull(),
    groupId: text('group_id').references(() => artboardGroups.id),
    roundId: uuid('round_id').references(() => artboardRounds.id, { onDelete: 'set null' }),
    ...ownerColumns,
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    // No foreign key on purpose: publishing an acceptance flow deletes and reinserts its nodes
    // under the same ids, and any ON DELETE action would drop the link each time.
    acceptanceFlowNodeId: uuid('acceptance_flow_node_id'),
    type: text('type').$type<ArtboardBoardType>().notNull(),
    title: text('title').notNull(),
    description: text('description'),
    expected: text('expected'),
    rect: jsonb('rect').$type<ArtboardRect>().notNull(),
    sourceWorkVersionId: uuid('source_work_version_id').references(() => workVersions.id, {
      onDelete: 'set null',
    }),
    sourcePath: text('source_path'),
    sourceFileId: text('source_file_id').references(() => files.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').$type<ArtboardBoardMetadata>(),
    ...timestamps,
  },
  (t) => [
    check(
      'artboard_boards_single_source_check',
      sql`num_nonnulls(${t.sourceWorkVersionId}, ${t.sourceFileId}) <= 1`,
    ),
    check(
      'artboard_boards_decision_no_source_check',
      sql`${t.type} <> 'decision' OR num_nonnulls(${t.sourceWorkVersionId}, ${t.sourceFileId}, ${t.sourcePath}) = 0`,
    ),
    index('artboard_boards_artboard_id_idx').on(t.artboardId),
    index('artboard_boards_page_id_idx').on(t.pageId),
    index('artboard_boards_group_id_idx')
      .on(t.groupId)
      .where(sql`${t.groupId} IS NOT NULL`),
    index('artboard_boards_round_id_idx')
      .on(t.roundId)
      .where(sql`${t.roundId} IS NOT NULL`),
    index('artboard_boards_project_id_idx')
      .on(t.projectId)
      .where(sql`${t.projectId} IS NOT NULL`),
    uniqueIndex('artboard_boards_acceptance_flow_node_id_unique')
      .on(t.acceptanceFlowNodeId)
      .where(sql`${t.acceptanceFlowNodeId} IS NOT NULL`),
    index('artboard_boards_source_work_version_id_idx')
      .on(t.sourceWorkVersionId)
      .where(sql`${t.sourceWorkVersionId} IS NOT NULL`),
    index('artboard_boards_user_id_idx').on(t.userId),
    index('artboard_boards_workspace_id_idx')
      .on(t.workspaceId)
      .where(sql`${t.workspaceId} IS NOT NULL`),
  ],
);

export const artboardEdges = pgTable(
  'artboard_edges',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    artboardId: artboardRef(),
    sourceBoardId: uuid('source_board_id')
      .references(() => artboardBoards.id, { onDelete: 'cascade' })
      .notNull(),
    targetBoardId: uuid('target_board_id')
      .references(() => artboardBoards.id, { onDelete: 'cascade' })
      .notNull(),
    ...ownerColumns,
    // No foreign key, for the same reason as `artboard_boards.acceptance_flow_node_id`.
    acceptanceFlowEdgeId: uuid('acceptance_flow_edge_id'),
    label: text('label').notNull().default(''),
    condition: text('condition'),
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    metadata: jsonb('metadata').$type<ArtboardEdgeMetadata>(),
    ...timestamps,
  },
  (t) => [
    index('artboard_edges_artboard_id_idx').on(t.artboardId),
    index('artboard_edges_source_board_id_idx').on(t.sourceBoardId),
    uniqueIndex('artboard_edges_source_board_id_default_unique')
      .on(t.sourceBoardId)
      .where(sql`${t.isDefault} = true`),
    index('artboard_edges_target_board_id_idx').on(t.targetBoardId),
    uniqueIndex('artboard_edges_acceptance_flow_edge_id_unique')
      .on(t.acceptanceFlowEdgeId)
      .where(sql`${t.acceptanceFlowEdgeId} IS NOT NULL`),
    index('artboard_edges_user_id_idx').on(t.userId),
    index('artboard_edges_workspace_id_idx')
      .on(t.workspaceId)
      .where(sql`${t.workspaceId} IS NOT NULL`),
  ],
);

export const artboardComments = pgTable(
  'artboard_comments',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    artboardId: artboardRef(),
    // Every reply points at the thread root; roots are null.
    parentCommentId: uuid('parent_comment_id').references((): AnyPgColumn => artboardComments.id, {
      onDelete: 'cascade',
    }),
    // The account that wrote the row; `user_id` is always the artboard owner so one account
    // deletion cascades the whole artboard.
    authorUserId: text('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    authorAgentId: text('author_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    ...ownerColumns,
    pageId: text('page_id').references(() => artboardPages.id),
    groupId: text('group_id').references(() => artboardGroups.id, { onDelete: 'set null' }),
    boardId: uuid('board_id').references(() => artboardBoards.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    clientId: text('client_id').notNull(),
    anchor: jsonb('anchor').$type<ArtboardCommentAnchor>(),
    deliveredAt: timestamptz('delivered_at'),
    resolvedAt: timestamptz('resolved_at'),
    resolvedByUserId: text('resolved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').$type<ArtboardCommentMetadata>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('artboard_comments_artboard_id_author_user_id_client_id_unique').on(
      t.artboardId,
      t.authorUserId,
      t.clientId,
    ),
    index('artboard_comments_artboard_id_created_at_idx').on(t.artboardId, t.createdAt),
    index('artboard_comments_parent_comment_id_idx').on(t.parentCommentId),
    index('artboard_comments_board_id_idx').on(t.boardId),
    index('artboard_comments_user_id_idx').on(t.userId),
    index('artboard_comments_workspace_id_idx')
      .on(t.workspaceId)
      .where(sql`${t.workspaceId} IS NOT NULL`),
    index('artboard_comments_page_id_idx').on(t.pageId),
    index('artboard_comments_group_id_idx')
      .on(t.groupId)
      .where(sql`${t.groupId} IS NOT NULL`),
  ],
);
