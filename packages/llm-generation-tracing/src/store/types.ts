import type { TracingPayload, TracingSummary } from '../types';

export interface SaveResult {
  /**
   * Canonical, globally addressable key for the saved payload (e.g. an S3
   * object key). `null` when the payload was persisted only to a local /
   * non-shareable location — the service should then leave `storage_key`
   * empty in the DB rather than record a path no other process can resolve.
   */
  key: string | null;
}

export interface ITracingStore {
  /** Optional retrieval — used by CLI / debug tooling only. */
  get?: (key: string) => Promise<TracingPayload | null>;
  /** Optional listing — used by CLI / debug tooling only. */
  list?: (options?: { limit?: number }) => Promise<TracingSummary[]>;
  /** Persist a tracing payload; returns the storage key for cross-reference. */
  save: (record: TracingPayload) => Promise<SaveResult>;
}
