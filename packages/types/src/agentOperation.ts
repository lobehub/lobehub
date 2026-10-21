import { z } from 'zod';

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

/**
 * Upper bound on the reply text a Stop request may carry. Generous enough for
 * long answers while keeping the interrupt request and its Redis sentinel small.
 */
export const INTERRUPT_STOP_SNAPSHOT_MAX_LENGTH = 200_000;

/**
 * What the client was showing for the streaming assistant message when the
 * user pressed Stop. The client freezes the bubble at that moment, while the
 * server may keep streaming until its step notices the interrupt; the step
 * boundary cuts the persisted reply back to this text so a later reload shows
 * the same reply the user stopped on.
 */
export const InterruptStopSnapshotSchema = z.object({
  assistantMessageId: z.string(),
  content: z.string().max(INTERRUPT_STOP_SNAPSHOT_MAX_LENGTH),
});

export type InterruptStopSnapshot = z.infer<typeof InterruptStopSnapshotSchema>;
