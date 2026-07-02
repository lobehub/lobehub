import type { AgentState } from '../types/state';

/**
 * Parked statuses are non-terminal, resumable pauses: the operation is still
 * alive but waiting on something out-of-band — human approval
 * (`waiting_for_human`) or an async tool / sub-agent result
 * (`waiting_for_async_tool`). They are deliberately distinct from `interrupted`
 * (user cancel) and the terminal `done` / `error`, so the completion lifecycle
 * never stamps `completedAt` and the scheduler keeps treating them as active.
 */
export const isParkedStatus = (status: AgentState['status']): boolean =>
  status === 'waiting_for_human' || status === 'waiting_for_async_tool';

/**
 * Blocked statuses halt the step loop — a parked pause or a user interrupt.
 * `done` / `error` terminate through their own handling.
 */
export const isBlockedStatus = (status: AgentState['status']): boolean =>
  isParkedStatus(status) || status === 'interrupted';
