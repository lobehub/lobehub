import { TRPCError } from '@trpc/server';

/**
 * An archived goal is hidden from every list, so it must stay put: starting,
 * resuming, restarting or pausing it would reopen work nobody can see. The caller
 * restores it first. Checked under the goal's row lock where the write takes
 * one, so it serializes with the guarded archive UPDATE (`GoalArchiveModel`).
 */
export const assertGoalNotArchived = (goal: { archivedAt?: Date | string | null; id: string }) => {
  if (!goal.archivedAt) return;
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: `Goal is archived; restore it first with lh goal unarchive ${goal.id}`,
  });
};
