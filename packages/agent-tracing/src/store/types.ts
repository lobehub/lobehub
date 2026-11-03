import type { ExecutionSnapshot, SnapshotSummary } from '../types';

export interface PartialSaveOptions {
  /**
   * Write only while the stored object still carries this token, which came
   * from an earlier read or write of the same partial. A store that can fence
   * answers `{ conflict: true }` instead of overwriting a newer copy; one that
   * cannot ignores it.
   */
  expected?: string;
  /** Cancels an upload whose result the caller no longer wants written. */
  signal?: AbortSignal;
}

export interface PartialSaveResult {
  /** The write was refused: someone else has written this partial since. */
  conflict?: boolean;
  /** Identifies what is stored now, to fence the caller's next write. */
  token?: string;
}

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
    options?: PartialSaveOptions,
  ) => Promise<PartialSaveResult | void>;
}
