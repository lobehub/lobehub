import type { ExecutionSnapshot, SnapshotSummary } from '../types';

export interface ISnapshotStore {
  get: (traceId: string) => Promise<ExecutionSnapshot | null>;
  getLatest: () => Promise<ExecutionSnapshot | null>;
  list: (options?: { limit?: number }) => Promise<SnapshotSummary[]>;
  /** Load in-progress partial snapshot */
  loadPartial: (operationId: string) => Promise<Partial<ExecutionSnapshot> | null>;

  /** Remove partial snapshot (after finalizing) */
  removePartial: (operationId: string) => Promise<void>;
  save: (snapshot: ExecutionSnapshot) => Promise<void>;
  /** Save in-progress partial snapshot */
  savePartial: (operationId: string, partial: Partial<ExecutionSnapshot>) => Promise<void>;
}
