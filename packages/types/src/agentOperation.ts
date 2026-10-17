export type AgentOperationStatus =
  | 'abandoned'
  | 'done'
  | 'error'
  | 'idle'
  | 'interrupted'
  | 'running'
  | 'waiting_for_async_tool'
  | 'waiting_for_client'
  | 'waiting_for_human';

const IN_FLIGHT_OPERATION_STATUSES = new Set<AgentOperationStatus>([
  'idle',
  'running',
  'waiting_for_async_tool',
  'waiting_for_client',
  'waiting_for_human',
]);

/**
 * Whether the operation has not settled yet and may still write to its topic or
 * thread. `idle` counts: the run exists but has not started.
 */
export const isAgentOperationInFlight = (status: AgentOperationStatus): boolean =>
  IN_FLIGHT_OPERATION_STATUSES.has(status);

/**
 * The complement of {@link isAgentOperationInFlight}: the run reached a
 * terminal state and nothing will write to its topic again. Kept as an explicit
 * set rather than `!isAgentOperationInFlight(status)` so an unknown or absent
 * status (a partial row, a value from a newer build) is NOT mistaken for a
 * settled one — callers use this to decide whether there is still work to
 * retire, where a wrong "yes" silently skips a live run.
 */
const SETTLED_OPERATION_STATUSES = new Set<AgentOperationStatus>([
  'abandoned',
  'done',
  'error',
  'interrupted',
]);

export const isAgentOperationSettled = (status: AgentOperationStatus | null | undefined): boolean =>
  status != null && SETTLED_OPERATION_STATUSES.has(status);

export type AgentOperationCompletionReason =
  | 'cost_limit'
  | 'done'
  | 'error'
  | 'interrupted'
  | 'lease_expired'
  | 'max_steps'
  /** The same tool call was requested over and over; a guard cut the run short. */
  | 'tool_call_repeat_limit'
  | 'waiting_for_async_tool'
  | 'waiting_for_client'
  | 'waiting_for_human';
