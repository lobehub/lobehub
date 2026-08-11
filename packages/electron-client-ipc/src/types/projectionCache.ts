export type DesktopProjectionSource = 'mutation' | 'network' | 'realtime';

export type DesktopProjectionKind = 'agent' | 'brief' | 'chatGroup' | 'task' | 'topic';

export const DESKTOP_PROJECTION_CACHE_TABLES = {
  agent: 'projection_agents',
  brief: 'projection_briefs',
  chatGroup: 'projection_chat_groups',
  homeIndexes: 'projection_home_indexes',
  homeSnapshots: 'projection_home_snapshots',
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

export interface DesktopProjectionRecord {
  fragments: Record<string, DesktopProjectionFragment>;
  id: string;
  kind: DesktopProjectionKind;
  tombstoneAt?: number;
}

export interface DesktopProjectionIndex {
  /** SuperJSON-encoded index fields excluding key and observation metadata. */
  data: string;
  key: string;
  observedAt: number;
  source: DesktopProjectionSource;
}

export interface DesktopProjectionSnapshot {
  /** SuperJSON-encoded snapshot payload. */
  data: string;
  key: string;
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

export interface DesktopProjectionRecordHydrationRequest {
  fragments: string[];
  ids: string[];
  kind: DesktopProjectionKind;
}

export interface DesktopProjectionHydrationRequest extends DesktopProjectionScope {
  indexes?: string[];
  records?: DesktopProjectionRecordHydrationRequest[];
  snapshots?: string[];
}

export interface DesktopProjectionScope {
  scope: string;
}
