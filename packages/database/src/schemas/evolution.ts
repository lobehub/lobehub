import type {
  EvolutionNodeStatus,
  EvolutionScorer,
  EvolutionSubjectType,
  EvolutionTreeConfig,
  EvolutionTreeStatus,
} from '@lobechat/types';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { amountNumeric, createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

// ── Evolution trees ──────────────────────────────────────
//
// Tree search over artifact versions: the artifact — a program, a config, a
// document — is what evolves, one rewrite at a time, judged by a programmatic
// scorer instead of an agent. The tree records every version ever produced
// (failed ones included), which version it was rewritten from, and how it
// scored, so the search can return to a long-superseded branch when the
// current best line stops paying.
//
// Split as session vs data, like `metrics` / `metric_points`:
//
// - `evolution_trees` — one row per search. Owns the objective, the scorer
//   contract, the budget/selection config, and the lifecycle. Polymorphic
//   subject with no FK (a Goal Work dispatches a search; a tree also runs
//   standalone), mirroring `metrics.subjectType`.
// - `evolution_nodes` — append-only versions. `parentId` is the version this
//   one was rewritten from; `visits` is the selection rule's accounting,
//   propagated to ancestors by the runtime. There is no `bestNodeId`
//   denormalization: best is `ORDER BY score DESC LIMIT 1` over the
//   (tree, score) index, and a stale pointer would be one more thing a
//   crashed worker could leave behind.
//
// This is deliberately NOT part of the Goal Graph. The graph is the strategic
// layer — why this search was opened, what came of it — and a couple hundred
// versions per search would bury it; the same reasoning that keeps metric
// time series out of graph nodes. One Work node maps to one tree; the final
// best artifact is registered as a work version deliverable.
export const evolutionTrees = pgTable(
  'evolution_trees',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('evolutionTrees'))
      .notNull(),

    // ── Ownership (denormalized for list queries / access control) ──
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    // ── Polymorphic subject ──
    subjectType: text('subject_type').$type<EvolutionSubjectType>().notNull(),
    subjectId: text('subject_id'),

    title: text('title').notNull(),
    /** What to evolve and toward what — the instruction every rewrite reads. */
    objective: text('objective').notNull(),

    /** The programmatic judge; higher is better by convention. */
    scorer: jsonb('scorer').$type<EvolutionScorer>().notNull(),
    config: jsonb('config').$type<EvolutionTreeConfig>(),

    status: text('status').$type<EvolutionTreeStatus>().default('pending').notNull(),
    /** The search operation currently (or last) driving this tree. */
    operationId: text('operation_id'),

    /** Consumer-owned extras the evolution layer never reads. */
    metadata: jsonb('metadata'),

    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('evolution_trees_user_id_idx').on(t.userId),
    index('evolution_trees_workspace_id_idx').on(t.workspaceId),
    index('evolution_trees_subject_idx').on(t.subjectType, t.subjectId),
    index('evolution_trees_status_idx').on(t.status),
  ],
);

export const evolutionNodes = pgTable(
  'evolution_nodes',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    treeId: text('tree_id')
      .references(() => evolutionTrees.id, { onDelete: 'cascade' })
      .notNull(),

    // ── Ownership (denormalized so buildWorkspaceWhere works without a join,
    // matching metric_points / task_topics) ──
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /**
     * The version this one was rewritten from; null only for the root. The FK
     * cascades so pruning a branch takes its descendants with it, but normal
     * operation never deletes mid-tree — failed versions stay, marked.
     */
    parentId: uuid('parent_id'),

    /** Version number within the tree, 1-based — "the 119th version". */
    seq: integer('seq').notNull(),

    /** The artifact itself. Whole text, not a diff: any node can be re-selected. */
    content: text('content').notNull(),
    /** The rewrite's own note of what it changed; for inspection, never parsed. */
    summary: text('summary'),

    status: text('status').$type<EvolutionNodeStatus>().default('pending').notNull(),
    /** Scalar from the scorer; null while pending and for failed runs. */
    score: amountNumeric('score'),
    /** Why the sandbox run failed, when it did. */
    error: text('error'),

    /**
     * The selection rule's accounting: how many times this node's subtree has
     * been chosen for a rewrite. Incremented on the whole ancestor chain per
     * iteration — the decay side of the rule reads it to move budget away from
     * over-worked branches.
     */
    visits: integer('visits').default(0).notNull(),

    /** The search operation that produced this version — join into tracing. */
    operationId: text('operation_id'),
    /** Scorer raw output / eval breakdown. Audit-only, never queried. */
    metadata: jsonb('metadata'),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('evolution_nodes_tree_seq_unique').on(t.treeId, t.seq),
    // Ranking reads: the selection rule and "best so far" both walk (tree, score).
    index('evolution_nodes_tree_score_idx').on(t.treeId, t.score),
    index('evolution_nodes_tree_parent_idx').on(t.treeId, t.parentId),
    index('evolution_nodes_user_id_idx').on(t.userId),
    index('evolution_nodes_workspace_id_idx').on(t.workspaceId),
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: 'evolution_nodes_parent_fk',
    }).onDelete('cascade'),
  ],
);

export type NewEvolutionTree = typeof evolutionTrees.$inferInsert;
export type EvolutionTreeItem = typeof evolutionTrees.$inferSelect;
export type NewEvolutionNode = typeof evolutionNodes.$inferInsert;
export type EvolutionNodeItem = typeof evolutionNodes.$inferSelect;
