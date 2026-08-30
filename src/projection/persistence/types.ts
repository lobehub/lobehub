import type {
  ProjectionCommit,
  ProjectionHydrationRequest,
  ProjectionIndex,
  ProjectionRecord,
  ProjectionSnapshot,
} from '@lobechat/types';

export type MaterializedProjectionCommit = Required<
  Pick<ProjectionCommit, 'indexes' | 'records' | 'snapshots'>
>;

export interface HydratedProjection {
  indexes: ProjectionIndex[];
  records: ProjectionRecord[];
  snapshots: ProjectionSnapshot[];
}

/** Runtime adapter below the shared Fragment/Projection entity engine. */
export interface ProjectionPersistence {
  clearScope: (scope: string) => Promise<void>;
  commit: (scope: string, commit: MaterializedProjectionCommit) => Promise<void>;
  hydrate: (scope: string, request: ProjectionHydrationRequest) => Promise<HydratedProjection>;
}
