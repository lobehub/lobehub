import type { GoalStatus } from './goal';

/**
 * Statuses a goal may be archived in: a draft the coordinator leaves alone
 * until someone starts it, and the terminal outcomes. Everything else can still
 * move without a person — the coordinator ticks a planning / running /
 * verifying goal, a review gate resumes it once answered, and a paused goal can
 * be lifted by a measurement or a release review. Archived goals drop out of
 * every list, so archiving one of those would let it keep working where nobody
 * sees it — the goal counterpart of `isTaskArchiveBlocked`.
 *
 * `GoalArchiveModel` applies the same list inside its UPDATE.
 */
export const GOAL_ARCHIVABLE_STATUSES = [
  'draft',
  'achieved',
  'failed',
  'canceled',
] as const satisfies readonly GoalStatus[];

const ARCHIVABLE = new Set<string>(GOAL_ARCHIVABLE_STATUSES);

/** Whether archiving a goal in this status would hide work that can still move. */
export const isGoalArchiveBlocked = (status: string): boolean => !ARCHIVABLE.has(status);
