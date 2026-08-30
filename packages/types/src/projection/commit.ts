import type { ProjectionTombstone } from './base';
import type { AgentIndexMap } from './modules/agent';
import type { BriefIndexMap } from './modules/brief';
import type { ChatIndexMap } from './modules/chat';
import type { ChatGroupIndexMap } from './modules/chatGroup';
import type { HomeIndexMap, HomeSnapshotMap } from './modules/home';
import type { TaskIndexMap } from './modules/task';
import type { ProjectionKind, ProjectionRecord } from './records';

/** Application-wide registry. Extend these maps when another data module is migrated. */
export type ProjectionIndexMap = AgentIndexMap &
  BriefIndexMap &
  ChatGroupIndexMap &
  ChatIndexMap &
  HomeIndexMap &
  TaskIndexMap;
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
