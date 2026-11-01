import type { TaskModel } from '@/database/models/task';

/**
 * The one place a Goal moves a Task back into work.
 *
 * Every such write competes with a person. Between the tick that decided to act and
 * the write that acts, someone can complete, cancel or fail the Task, and a
 * supervisor diagnosis can sit in between for minutes. So the claim is conditioned on
 * the status the decision was made against — never on a freshly re-read one, which
 * would swap whatever the person just chose and start paid work over their decision.
 *
 * Losing the compare-and-set is the correct outcome, not an error: it means the row
 * moved, so this decision is stale and belongs to whoever moved it.
 */
export const claimGoalTask = async (
  taskModel: TaskModel,
  /** The Task as the caller read it when it decided, not a fresh re-read. */
  decidedOn: { id: string; status: string },
  to: 'backlog' | 'running',
  extra?: { error?: string | null; startedAt?: Date },
) => taskModel.updateStatusIfCurrent(decidedOn.id, decidedOn.status, to, extra);
