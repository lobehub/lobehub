import type { ProjectionTombstone } from './base';
import type { HomeIndexMap, HomeSnapshotMap } from './modules/home';
import type { ProjectionKind, ProjectionRecord } from './records';

/** Application-wide registry. Extend these maps when another data module is migrated. */
export interface ProjectionIndexMap extends HomeIndexMap {}
export interface ProjectionSnapshotMap extends HomeSnapshotMap {}

export type ProjectionIndexKey = keyof ProjectionIndexMap;
export type ProjectionIndex = ProjectionIndexMap[ProjectionIndexKey];
export type ProjectionSnapshotKey = keyof ProjectionSnapshotMap;
export type ProjectionSnapshot = ProjectionSnapshotMap[ProjectionSnapshotKey];

export interface ProjectionCommit {
  indexes?: ProjectionIndex[];
  records?: ProjectionRecord[];
  snapshots?: ProjectionSnapshot[];
  tombstones?: ProjectionTombstone<ProjectionKind>[];
}

export interface ProjectionRequestMarker {
  observedAt: number;
}
