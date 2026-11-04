import type { GoalStatus } from './goal';

/** What decides whether a goal may be archived. */
export interface GoalArchiveGuardInput {
  status: GoalStatus | string;
}

/**
 * A goal may be archived once it has ended as completed (`achieved`) or
 * canceled. A failed goal still waits on a retry or a continuation, and an
 * open one can move on its own, so hiding it from every list would leave that
 * decision out of sight.
 *
 * Archiving does not wait on the owner's sign-off: an achieved goal may have no
 * Goal-level acceptance to sign off at all (marked completed by hand, say), and
 * gating on it left such a goal impossible to put away.
 *
 * `GoalArchiveModel` applies the same rule inside its UPDATE.
 */
export const isGoalArchiveBlocked = ({ status }: GoalArchiveGuardInput): boolean =>
  !(status === 'achieved' || status === 'canceled');
