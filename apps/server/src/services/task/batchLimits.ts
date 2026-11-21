/**
 * Batch contract shared by the router and the service. Kept free of imports:
 * the router module is reachable from the service's own import graph, so the
 * schema must not wait on the service module to finish evaluating.
 */

/** Upper bound of ids one batch request may carry. */
export const TASK_BATCH_MAX_IDS = 500;

/** Statuses a person can move many tasks to at once (see `USER_SELECTABLE_STATUSES`). */
export const TASK_BATCH_STATUSES = ['backlog', 'paused', 'completed', 'canceled'] as const;
export type TaskBatchStatus = (typeof TASK_BATCH_STATUSES)[number];
