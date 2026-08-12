import type {
  ProjectionFragmentName,
  ProjectionIndexKey,
  ProjectionKind,
  ProjectionSnapshotKey,
  ProjectionSource,
} from '@lobechat/types';

export type DesktopProjectionSource = ProjectionSource;

export type DesktopProjectionKind = ProjectionKind;

export const DESKTOP_PROJECTION_CACHE_TABLES = {
  agent: 'projection_agents',
  brief: 'projection_briefs',
  chatGroup: 'projection_chat_groups',
  indexes: 'projection_indexes',
  snapshots: 'projection_snapshots',
  task: 'projection_tasks',
  topic: 'projection_topics',
} as const;

export type DesktopProjectionCacheTable =
  (typeof DESKTOP_PROJECTION_CACHE_TABLES)[keyof typeof DESKTOP_PROJECTION_CACHE_TABLES];

export interface DesktopProjectionFragment {
  /** SuperJSON-encoded fragment data. */
  data: string;
  observedAt: number;
  source: DesktopProjectionSource;
}

export type DesktopProjectionRecord = {
  [Kind in ProjectionKind]: {
    fragments: Partial<Record<ProjectionFragmentName<Kind>, DesktopProjectionFragment>>;
    id: string;
    kind: Kind;
    tombstoneAt?: number;
  };
}[ProjectionKind];

export interface DesktopProjectionIndex {
  /** SuperJSON-encoded index fields excluding key and observation metadata. */
  data: string;
  key: ProjectionIndexKey;
  observedAt: number;
  source: DesktopProjectionSource;
}

export interface DesktopProjectionSnapshot {
  /** SuperJSON-encoded snapshot payload. */
  data: string;
  key: ProjectionSnapshotKey;
  observedAt: number;
  source: DesktopProjectionSource;
}

export interface DesktopProjectionCommit {
  indexes?: DesktopProjectionIndex[];
  records?: DesktopProjectionRecord[];
  scope: string;
  snapshots?: DesktopProjectionSnapshot[];
}

export interface DesktopProjectionHydration {
  indexes: DesktopProjectionIndex[];
  records: DesktopProjectionRecord[];
  snapshots: DesktopProjectionSnapshot[];
  timing?: DesktopProjectionHydrationTiming;
}

export interface DesktopProjectionHydrationTiming {
  /** Main-process SQLite read and row-materialization duration. */
  databaseReadMs: number;
}

export type DesktopProjectionRecordHydrationRequest = {
  [Kind in ProjectionKind]: {
    fragments: ProjectionFragmentName<Kind>[];
    ids: string[];
    kind: Kind;
  };
}[ProjectionKind];

export interface DesktopProjectionHydrationRequest extends DesktopProjectionScope {
  indexes?: ProjectionIndexKey[];
  records?: DesktopProjectionRecordHydrationRequest[];
  snapshots?: ProjectionSnapshotKey[];
}

export interface DesktopProjectionScope {
  scope: string;
}
