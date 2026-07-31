import type { TaskEntityRecord } from '@lobechat/types';

import type { ClientDataScopeState } from '../core/initialState';

export const findTaskEntityRecord = (
  scope: ClientDataScopeState | undefined,
  identity: string,
): TaskEntityRecord | undefined => {
  if (!scope) return undefined;
  const direct = scope.entities.task[identity];
  if (direct) return direct;
  return Object.values(scope.entities.task).find(
    (record) => record.fragments.identity?.data.identifier === identity,
  );
};
