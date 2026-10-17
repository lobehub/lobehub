import type {
  GoalSubscriptionCursor,
  GoalSubscriptionFreshnessPolicy,
  GoalSubscriptionSemanticBinding,
  GoalSubscriptionWakeCondition,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
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

import { timestamps } from './_helpers';
import { goals } from './goal';
import { metrics } from './metric';
import { users } from './user';
import { widgets, widgetVersions } from './widget';
import { workspaces } from './workspace';

/** A Goal consumes existing Widget runs/metrics; no observations are copied here. */
export const goalSubscriptions = pgTable(
  'goal_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    goalId: text('goal_id')
      .references(() => goals.id, { onDelete: 'cascade' })
      .notNull(),
    widgetId: uuid('widget_id')
      .references(() => widgets.id, { onDelete: 'cascade' })
      .notNull(),
    metricId: text('metric_id').references(() => metrics.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').default(false).notNull(),
    /** Immutable Widget version explicitly approved for this binding. */
    confirmedVersionId: uuid('confirmed_version_id')
      .references(() => widgetVersions.id, { onDelete: 'cascade' })
      .notNull(),
    /** Compare-and-set fence against callbacks from an obsolete binding. */
    bindingRevision: integer('binding_revision').default(1).notNull(),
    binding: jsonb('binding').$type<GoalSubscriptionSemanticBinding>().notNull(),
    wakeCondition: jsonb('wake_condition').$type<GoalSubscriptionWakeCondition>().notNull(),
    freshnessPolicy: jsonb('freshness_policy').$type<GoalSubscriptionFreshnessPolicy>().notNull(),
    cursor: jsonb('cursor').$type<GoalSubscriptionCursor>().default({}).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('goal_subscriptions_goal_widget_metric_unique')
      .on(t.goalId, t.widgetId, t.metricId)
      .where(sql`${t.metricId} IS NOT NULL`),
    uniqueIndex('goal_subscriptions_goal_widget_result_unique')
      .on(t.goalId, t.widgetId)
      .where(sql`${t.metricId} IS NULL`),
    index('goal_subscriptions_widget_enabled_idx')
      .on(t.widgetId, t.workspaceId, t.userId)
      .where(sql`${t.enabled} = true`),
    index('goal_subscriptions_personal_idx')
      .on(t.userId, t.goalId)
      .where(sql`${t.workspaceId} IS NULL`),
    index('goal_subscriptions_workspace_idx').on(t.workspaceId, t.goalId),
    index('goal_subscriptions_metric_id_idx').on(t.metricId),
    index('goal_subscriptions_confirmed_version_id_idx').on(t.confirmedVersionId),
    index('goal_subscriptions_reconcile_idx')
      .on(t.updatedAt, t.id)
      .where(sql`${t.enabled} = true`),
    check('goal_subscriptions_binding_revision_positive', sql`${t.bindingRevision} > 0`),
  ],
);

export type GoalSubscriptionRow = typeof goalSubscriptions.$inferSelect;
export type NewGoalSubscriptionRow = typeof goalSubscriptions.$inferInsert;
