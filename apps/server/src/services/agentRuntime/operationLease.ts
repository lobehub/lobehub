/**
 * How long an operation may go without refreshing its durable liveness lease
 * (`agent_operations.updated_at`) before it is treated as dead.
 *
 * `AgentRuntimeService.startStepLockHeartbeat` touches the row every
 * `STEP_LOCK_HEARTBEAT_MS * DURABLE_LEASE_HEARTBEAT_EVERY_TICKS` = 90s while a
 * step holds the step lock, so five minutes is three missed beats: comfortably
 * past jitter, and far tighter than the 30-minute in-flight window the gateway
 * watchdog has to use (it can only reason about stream events, which stop for
 * legitimately slow first-token latency too).
 */
export const OPERATION_LEASE_STALE_MS = 5 * 60_000;

/**
 * How long a heterogeneous run (Claude Code, Codex, …) may go without any
 * `heteroIngest` batch before it is treated as dead.
 *
 * Deliberately the same window as the agent-gateway inactivity watchdog uses
 * for hetero runs (`INACTIVITY_WATCHDOG_TIMEOUT_HETERO`, 60 min): a long shell
 * command inside the CLI reaches the server as silence, and this must not be
 * stricter than the path it backs up. The two read the same clock — every
 * ingest batch both refreshes this lease and pushes the events that reset the
 * gateway's — so whichever runs first wins and the other finds the row
 * terminal.
 */
export const HETERO_OPERATION_SILENCE_MS = 60 * 60_000;

/** Whether a `running` row's lease was refreshed recently enough to count as alive. */
export const isOperationLeaseFresh = (
  operation: { updatedAt: Date },
  options: { heterogeneous?: boolean; now?: number } = {},
): boolean => {
  const window = options.heterogeneous ? HETERO_OPERATION_SILENCE_MS : OPERATION_LEASE_STALE_MS;
  return (options.now ?? Date.now()) - operation.updatedAt.getTime() < window;
};
