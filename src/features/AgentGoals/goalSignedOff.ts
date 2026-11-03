import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import type { GoalGraphSnapshot } from '@lobechat/types';

/**
 * Whether the owner signed the goal off: it is achieved and its Goal-level
 * acceptance was accepted. The detail page's counterpart of the list row's
 * `signedOff`, read from the graph snapshot it already holds.
 */
export const isGoalSnapshotSignedOff = (
  snapshot: Pick<GoalGraphSnapshot, 'acceptances' | 'goal' | 'nodes'> | undefined,
): boolean =>
  snapshot?.goal.status === 'achieved' &&
  snapshot.nodes.some(
    (node) =>
      node.kind === 'task' &&
      node.title === GOAL_ACCEPTANCE_TASK_TITLE &&
      snapshot.acceptances?.[node.id]?.status === 'accepted',
  );
