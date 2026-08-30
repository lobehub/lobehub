import type { ProjectionIndexKey, ProjectionSnapshotKey } from './commit';
import type { ProjectionFragmentName, ProjectionKind } from './records';

export type ProjectionRecordHydrationRequest = {
  [K in ProjectionKind]: {
    fragments: ProjectionFragmentName<K>[];
    ids: string[];
    kind: K;
  };
}[ProjectionKind];

/** A bounded local-cache read. Missing rows are ordinary cache misses. */
export interface ProjectionHydrationRequest {
  indexes?: ProjectionIndexKey[];
  records?: ProjectionRecordHydrationRequest[];
  snapshots?: ProjectionSnapshotKey[];
}
