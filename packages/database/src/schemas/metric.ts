import type {
  MetricActorType,
  MetricConfig,
  MetricKind,
  MetricPointSourceType,
  MetricSubjectType,
} from '@lobechat/types';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { amountNumeric, createdAt, softDeleteColumns, timestamptz, updatedAt } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

// ── Metrics ──────────────────────────────────────────────
//
// A generic numeric time series, split into definition and data:
//
// - `metrics` — one row per series ("one row = one chartable line"). Owns the
//   identity (subject + key) and everything a renderer needs that the data
//   cannot say for itself: aggregation semantics (`kind`), formatting
//   (`unit`), and display/evaluation hints (`config`).
// - `metric_points` — append-only (t, v) observations. Strictly numeric on
//   purpose: charts need SQL-side bucketing and aggregation, which a JSONB
//   value would forfeit. Non-numeric observations are events, not metrics —
//   they belong to the consumer's own domain (e.g. Goal Graph observation
//   nodes), not here.
//
// The subject link is polymorphic with no FK, mirroring `goals.subjectType`:
// the same two tables serve goal criteria, agent cost curves, or workspace
// dashboards without knowing any of those domains. Existence and ownership of
// the subject are validated by the service that binds it.
export const metrics = pgTable(
  'metrics',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('metrics'))
      .notNull(),

    // ── Ownership (denormalized for list queries / access control) ──
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    // ── Polymorphic subject ──
    subjectType: text('subject_type').$type<MetricSubjectType>().notNull(),
    subjectId: text('subject_id').notNull(),

    // ── Series identity ──
    /** Stable machine name within the subject, e.g. 'twitter.followers'. */
    key: text('key').notNull(),
    /** Display name; null falls back to `key` in the UI. */
    title: text('title'),

    // ── Chart semantics ──
    kind: text('kind').$type<MetricKind>().default('gauge').notNull(),
    /** Formatting hint: 'count' | 'usd' | 'percent' | 'ms' | free text. */
    unit: text('unit'),
    config: jsonb('config').$type<MetricConfig>(),

    /**
     * Consumer-owned extras (probe wiring, external source descriptors, …).
     * Split from `config` on purpose: `config` is the renderer/evaluator
     * contract with typed, known fields — `metadata` is a free bag the metrics
     * layer never reads, so consumers can stash context without widening the
     * contract.
     */
    metadata: jsonb('metadata'),

    /** Recycle bin — see `schemas/trash.ts`. */
    ...softDeleteColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One series per (subject, key): upserting a probe write is a lookup on
    // exactly this triple, and two series with the same key on one subject
    // would be indistinguishable to criteria evaluation.
    uniqueIndex('metrics_subject_key_unique').on(t.subjectType, t.subjectId, t.key),
    index('metrics_user_id_idx').on(t.userId),
    index('metrics_workspace_id_idx').on(t.workspaceId),
  ],
);

export const metricPoints = pgTable(
  'metric_points',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    metricId: text('metric_id')
      .references(() => metrics.id, { onDelete: 'cascade' })
      .notNull(),

    // ── Ownership (denormalized so buildWorkspaceWhere works without a join,
    // matching taskTopics / goal_events) ──
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    value: amountNumeric('value').notNull(),

    /**
     * When the value was true in the world — distinct from `createdAt` (when
     * the row was written), so backfilled observations land on the right spot
     * of the chart.
     */
    observedAt: timestamptz('observed_at').notNull(),

    // ── Provenance (mirrors the goal_events actor convention) ──
    actorType: text('actor_type').$type<MetricActorType>().notNull(),
    actorId: text('actor_id'),
    /** The agent run that sampled this point — join key into agent-tracing. */
    operationId: text('operation_id'),
    sourceType: text('source_type').$type<MetricPointSourceType>().notNull(),

    /** Raw sampling payload / evidence link. Audit-only, never queried. */
    metadata: jsonb('metadata'),

    createdAt: createdAt(),
  },
  (t) => [
    // The one hot path: range reads for charts and latest-value reads for
    // criteria evaluation both walk (series, time).
    index('metric_points_series_time_idx').on(t.metricId, t.observedAt),
    index('metric_points_user_id_idx').on(t.userId),
    index('metric_points_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewMetric = typeof metrics.$inferInsert;
export type MetricItem = typeof metrics.$inferSelect;
export type NewMetricPoint = typeof metricPoints.$inferInsert;
export type MetricPointItem = typeof metricPoints.$inferSelect;
