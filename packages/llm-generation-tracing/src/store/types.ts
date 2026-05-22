import type { TracingPayload, TracingSummary } from '../types';

export interface SaveResult {
  /** Storage key (S3 object key or local file path) for the saved payload. */
  key: string;
}

export interface ITracingStore {
  /** Optional retrieval — used by CLI / debug tooling only. */
  get?: (key: string) => Promise<TracingPayload | null>;
  /** Optional listing — used by CLI / debug tooling only. */
  list?: (options?: { limit?: number }) => Promise<TracingSummary[]>;
  /** Persist a tracing payload; returns the storage key for cross-reference. */
  save: (record: TracingPayload) => Promise<SaveResult>;
}
