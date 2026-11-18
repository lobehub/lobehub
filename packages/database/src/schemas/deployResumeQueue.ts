import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';

/**
 * What the entry points to resume.
 *
 * - `task` — the interrupted operation ran under a `task_topics` row; the
 *   resumer replays it through `TaskRunnerService.runTask` so the Task's own
 *   bookkeeping (run row, lifecycle hook, status) is restored with it.
 * - `chat` — an ordinary conversation turn; the resumer re-sends the topic's
 *   last user message through `startComposerRun`, the same path the composer
 *   uses.
 */
export const DEPLOY_RESUME_KINDS = ['task', 'chat'] as const;
export type DeployResumeKind = (typeof DEPLOY_RESUME_KINDS)[number];

/**
 * Queue row lifecycle.
 *
 * `pending` is the only state the resumer picks up; `running` is the claim a
 * single boot holds while it dispatches, and every terminal state keeps the
 * row for audit instead of deleting it (`done` / `failed` / `skipped`).
 */
export const DEPLOY_RESUME_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;
export type DeployResumeStatus = (typeof DEPLOY_RESUME_STATUSES)[number];

/** Terminal states: a row that reached one of them is never picked up again. */
export const DEPLOY_RESUME_TERMINAL_STATUSES: DeployResumeStatus[] = ['done', 'failed', 'skipped'];

/**
 * Extra coordinates captured at settle time, so a resume never has to re-derive
 * them from tables that may have moved on since (a topic can be renamed, a
 * message edited or deleted while the container is down).
 */
export interface DeployResumePayload {
  /**
   * The last `role='user'` message of the topic as it stood when the container
   * stopped. Only written for `chat` rows: the resume re-sends exactly what the
   * user asked, even if the row was edited away in the meantime.
   */
  lastUserMessage?: string;
  /** Where the deploy settle found the operation — see the script's `reconcile_runs`. */
  settledAs?: 'task-run' | 'residual-chat';
}

/**
 * Conversations a deploy update interrupted, queued for replay once the new
 * container is up.
 *
 * Written by `scripts/deploy-custom-image.sh` right before it settles the
 * in-flight `agent_operations` — which is what makes it the only record of
 * "this turn was killed by the update, not by the user". The resumer
 * (`apps/server/src/services/deployResume`) drains it at boot.
 *
 * One row per topic, keyed by the unique index below: a topic interrupted by
 * two consecutive deploys is re-armed (`ON CONFLICT ... DO UPDATE`) rather than
 * queued twice, which is what "同一会话只恢复一次" means per boot. `user_id` /
 * `workspace_id` carry no FK on purpose — the queue must survive a user or
 * workspace deletion that happened while the container was down, so the resumer
 * can mark the row `skipped` instead of failing the insert with a constraint.
 */
export const deployResumeQueue = pgTable(
  'deploy_resume_queue',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('deployResumeQueue'))
      .primaryKey(),

    kind: text('kind', { enum: DEPLOY_RESUME_KINDS }).notNull(),
    status: text('status', { enum: DEPLOY_RESUME_STATUSES }).notNull().default('pending'),

    /** Owning Task for `task` rows; absent for `chat` rows. */
    taskId: text('task_id'),
    topicId: text('topic_id').notNull(),
    /** The operation that was in flight when the container stopped. */
    operationId: text('operation_id'),

    userId: text('user_id').notNull(),
    workspaceId: text('workspace_id'),

    payload: jsonb('payload').$type<DeployResumePayload>(),

    /** Dispatch attempts so far; the resumer gives up past a small bound. */
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    /** When the resume was dispatched (or skipped) — the row's audit anchor. */
    resumedAt: timestamptz('resumed_at'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The resumer's only query: oldest pending rows first, capped per boot.
    index('deploy_resume_queue_status_created_at_idx').on(t.status, t.createdAt),
    // One row per conversation; re-armed in place by a later deploy.
    uniqueIndex('deploy_resume_queue_topic_id_unique').on(t.topicId),
  ],
);

export type DeployResumeQueueItem = typeof deployResumeQueue.$inferSelect;
export type NewDeployResumeQueueItem = typeof deployResumeQueue.$inferInsert;
