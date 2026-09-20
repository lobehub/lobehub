import type { ExecutionSnapshot, SnapshotSummary } from '../types';

export interface ISnapshotStore {
  get: (traceId: string) => Promise<ExecutionSnapshot | null>;
  getLatest: () => Promise<ExecutionSnapshot | null>;
  list: (options?: { limit?: number }) => Promise<SnapshotSummary[]>;
  /** List in-progress partial snapshot filenames */
  listPartials: () => Promise<string[]>;
  /** Load in-progress partial snapshot */
  loadPartial: (operationId: string) => Promise<Partial<ExecutionSnapshot> | null>;

  /** Remove partial snapshot (after finalizing) */
  removePartial: (operationId: string) => Promise<void>;
  save: (snapshot: ExecutionSnapshot) => Promise<void>;
  /**
   * Save in-progress partial snapshot. `signal` lets a caller that no longer
   * owns the operation abort an upload it already started, so it cannot land on
   * top of the partial the new owner is writing.
   */
  savePartial: (
    operationId: string,
    partial: Partial<ExecutionSnapshot>,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
}
