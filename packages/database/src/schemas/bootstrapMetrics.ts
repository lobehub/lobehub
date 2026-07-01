import { boolean, index, integer, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers';

export const clientBootstrapMetrics = pgTable(
  'client_bootstrap_metrics',
  {
    id: text('id').primaryKey(),
    createdAt: createdAt(),
    appVersion: text('app_version').notNull(),
    platform: varchar('platform').notNull(),
    isLogin: boolean('is_login').notNull(),
    cold: boolean('cold').notNull(),
    totalMs: integer('total_ms').notNull(),
    userId: text('user_id'),
    anonId: text('anon_id'),
    browser: text('browser'),
    os: text('os'),
    country: text('country'),
    details: jsonb('details'),
  },
  (t) => [
    index('idx_bootstrap_metrics_version_created').on(t.appVersion, t.createdAt),
    index('idx_bootstrap_metrics_platform_created').on(t.platform, t.createdAt),
    index('idx_bootstrap_metrics_created').on(t.createdAt),
    index('idx_bootstrap_metrics_cold_created').on(t.cold, t.createdAt),
  ],
);

export type NewClientBootstrapMetric = typeof clientBootstrapMetrics.$inferInsert;
export type ClientBootstrapMetricItem = typeof clientBootstrapMetrics.$inferSelect;

export const clientBootstrapSpans = pgTable(
  'client_bootstrap_spans',
  {
    id: text('id').primaryKey(),
    metricId: text('metric_id')
      .notNull()
      .references(() => clientBootstrapMetrics.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startMs: integer('start_ms').notNull(),
    durMs: integer('dur_ms').notNull(),
  },
  (t) => [
    index('idx_bootstrap_spans_metric').on(t.metricId),
    index('idx_bootstrap_spans_name').on(t.name),
  ],
);

export type NewClientBootstrapSpan = typeof clientBootstrapSpans.$inferInsert;
export type ClientBootstrapSpanItem = typeof clientBootstrapSpans.$inferSelect;
