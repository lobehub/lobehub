import type { GoalStatus } from './goal';

/** What decides whether a goal may be archived. */
export interface GoalArchiveGuardInput {
  /** Its Goal-level acceptance was accepted by the owner. */
  signedOff?: boolean;
  status: GoalStatus | string;
}

/**
 * A goal may be archived once it is truly done with: achieved and signed off
 * by its owner, or canceled. Anything else still has a decision left — an
 * achieved goal waits on its sign-off (and the owner may still send it back),
 * a failed one on a retry or a continuation, and an open one can move on its
 * own — so hiding it from every list would leave that decision out of sight.
 *
 * `GoalArchiveModel` applies the same rule inside its UPDATE.
 */
export const isGoalArchiveBlocked = ({ signedOff, status }: GoalArchiveGuardInput): boolean =>
  !(status === 'canceled' || (status === 'achieved' && !!signedOff));
