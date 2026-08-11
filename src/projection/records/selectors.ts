import type { TaskProjection } from '@lobechat/types';

import type { ProjectionScopeState } from '../core/initialState';

export const findTaskProjection = (
  scope: ProjectionScopeState | undefined,
  identity: string,
): TaskProjection | undefined => {
  if (!scope) return undefined;
  const direct = scope.records.task[identity];
  if (direct) return direct;
  return Object.values(scope.records.task).find(
    (record) => record.fragments.identity?.data.identifier === identity,
  );
};
