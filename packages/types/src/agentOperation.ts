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
  | 'waiting_for_async_tool'
  | 'waiting_for_human';
