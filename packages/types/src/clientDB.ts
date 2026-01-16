// Define loading state types
export enum DatabaseLoadingState {
  Error = 'error',
  Finished = 'finished',
  Idle = 'idle',
  Initializing = 'initializing',
  LoadingDependencies = 'loadingDependencies',
  LoadingWasm = 'loadingWasm',
  Migrating = 'migrating',
  Ready = 'ready',
}

export const ClientDatabaseInitStages = [
  DatabaseLoadingState.Idle,
  DatabaseLoadingState.Initializing,
  DatabaseLoadingState.LoadingDependencies,
  DatabaseLoadingState.LoadingWasm,
  DatabaseLoadingState.Migrating,
  DatabaseLoadingState.Finished,
];

// Define progress callback interface
export interface ClientDBLoadingProgress {
  costTime?: number;
  phase: 'wasm' | 'dependencies';
  progress: number;
}

export type OnStageChange = (state: DatabaseLoadingState) => void;

export interface MigrationSQL {
  bps: boolean;
  folderMillis: number;
  hash: string;
  sql: string[];
}

export interface MigrationTableItem {
  created_at: number;
  hash: string;
  id: number;
}
