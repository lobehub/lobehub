import type { TaskAcceptanceStateKey } from './resolveTaskAcceptanceState';

export type TaskStatusStripLead =
  | { kind: 'acceptance'; needsDecision: boolean; state: TaskAcceptanceStateKey }
  | { kind: 'awaitingAcceptance' }
  | { kind: 'status' };

const NEEDS_DECISION: Partial<Record<TaskAcceptanceStateKey, true>> = {
  awaitingDecision: true,
  awaitingReview: true,
};

/**
 * What the status strip leads with.
 *
 * `running` also covers a stopped agent whose acceptance round has yet to
 * settle (`acceptanceWaiting`); only an executing agent outranks the
 * acceptance state. A delivery that waits on the human's decision makes that
 * decision the strip's primary action instead of another run.
 */
export const resolveTaskStatusStripLead = (
  status: string | undefined,
  acceptanceWaiting: boolean,
  acceptanceState: TaskAcceptanceStateKey | undefined,
): TaskStatusStripLead => {
  const executing = status === 'running' && !acceptanceWaiting;
  if (!executing && acceptanceState)
    return {
      kind: 'acceptance',
      needsDecision: !!NEEDS_DECISION[acceptanceState],
      state: acceptanceState,
    };
  if (acceptanceWaiting) return { kind: 'awaitingAcceptance' };
  return { kind: 'status' };
};
