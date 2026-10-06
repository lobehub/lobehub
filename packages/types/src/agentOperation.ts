export type AgentOperationStatus =
  | 'abandoned'
  | 'done'
  | 'error'
  | 'idle'
  | 'interrupted'
  | 'running'
  | 'waiting_for_async_tool'
  | 'waiting_for_human';

const IN_FLIGHT_OPERATION_STATUSES = new Set<AgentOperationStatus>([
  'idle',
  'running',
  'waiting_for_async_tool',
  'waiting_for_human',
]);

/**
 * Whether the operation has not settled yet and may still write to its topic or
 * thread. `idle` counts: the run exists but has not started.
 */
export const isAgentOperationInFlight = (status: AgentOperationStatus): boolean =>
  IN_FLIGHT_OPERATION_STATUSES.has(status);

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
  | 'waiting_for_human';
