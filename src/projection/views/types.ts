import type {
  ProjectionHydrationRequest,
  ProjectionIndexKey,
  ProjectionRecordHydrationRequest,
  ProjectionSnapshotKey,
} from '@lobechat/types';

import type { ProjectionScopeState } from '../core/initialState';

export interface ProjectionViewContract<Params> {
  indexes?: (params: Params) => ProjectionIndexKey[];
  key: (params: Params) => string;
  records?: (
    scope: ProjectionScopeState | undefined,
    params: Params,
  ) => ProjectionRecordHydrationRequest[];
  snapshots?: (params: Params) => ProjectionSnapshotKey[];
}

export type ProjectionViewHydrationRequest = ProjectionHydrationRequest;
