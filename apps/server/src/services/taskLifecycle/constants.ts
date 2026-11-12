/**
 * How long a run may hold a `running` row after its operation already ended
 * before the sweep calls it orphaned.
 *
 * The operation is settled *before* its `onComplete` hook is dispatched, so this
 * window is what keeps the sweep from racing the normal path — including a hook
 * whose first delivery fails and is retried. It is deliberately the same order
 * of magnitude as the goal sweep's own stale window: both are looking for the
 * same class of lost delivery, just from opposite ends of the graph.
 */
export const ORPHANED_RUN_GRACE_MS = 15 * 60 * 1000;
