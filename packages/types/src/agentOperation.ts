export type AgentOperationStatus =
  | 'abandoned'
  | 'done'
  | 'error'
  | 'idle'
  | 'interrupted'
  | 'running'
  | 'waiting_for_async_tool'
  | 'waiting_for_human';

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
