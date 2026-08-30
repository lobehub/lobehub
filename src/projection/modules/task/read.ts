import type { TaskDetailData } from '@lobechat/types';

import { getCacheScope } from '@/libs/swr/useCacheScope';

import type { ProjectionScopeState } from '../../core/initialState';
import { getProjectionStoreState } from '../../store';
import { findTaskRecordByIdentity, selectTaskDetail } from './selectors';

export const getTaskProjection = <Selected>(
  selector: (scope: ProjectionScopeState | undefined) => Selected,
): Selected => selector(getProjectionStoreState().scopes[getCacheScope()]);

export const getTaskDetailProjection = (identity: string): TaskDetailData | undefined =>
  getTaskProjection((scope) => selectTaskDetail(findTaskRecordByIdentity(scope, identity)));

/**
 * Temporary mutation working set derived from Projection on demand. It is not
 * retained by any store; reducers and OptimisticEngine use it only to compute
 * the next canonical commit.
 */
export const getTaskDetailProjectionMap = (): Record<string, TaskDetailData> =>
  getTaskProjection((scope) => {
    if (!scope) return {};

    const map: Record<string, TaskDetailData> = {};
    for (const record of Object.values(scope.records.task)) {
      const detail = selectTaskDetail(record);
      if (!detail) continue;
      map[record.id] = detail;
      map[detail.identifier] = detail;
      if (detail.id) map[detail.id] = detail;
    }
    return map;
  });
