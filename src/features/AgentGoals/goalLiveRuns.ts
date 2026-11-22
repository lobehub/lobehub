import type { GoalGraphSnapshot } from '@lobechat/types';

/**
 * Whether the goal has work that "stop" would actually interrupt: a run holding
 * a live topic, or a repair under way on a delivered Task. A Task node stays
 * `active` after its run is stopped, so node status alone cannot answer this.
 */
export const hasLiveGoalRuns = ({
  acceptances,
  runHeartbeats,
}: Pick<GoalGraphSnapshot, 'acceptances' | 'runHeartbeats'>): boolean =>
  Object.keys(runHeartbeats ?? {}).length > 0 ||
  Object.values(acceptances ?? {}).some(
    (acceptance) => acceptance.repairing || acceptance.status === 'repairing',
  );
