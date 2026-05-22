export type LlmGenerationFeedbackSignal = 'positive' | 'negative' | 'neutral';

export interface TracingErrorPayload {
  code?: string;
  message?: string;
  stack?: string;
}

export interface TracingModelMetadata {
  [key: string]: unknown;
  finish_reason?: string;
  model?: string;
  provider?: string;
}

/**
 * Blob payload written to the store. Mirrors the design's Blob schema —
 * the DB row stores indexable summary columns; this carries the full prompt /
 * input / output detail for offline analysis.
 *
 * Version field guards future schema evolution.
 */
export interface TracingPayload {
  created_at: number;
  error?: TracingErrorPayload;
  input?: unknown;
  model_metadata?: TracingModelMetadata;
  output?: unknown;
  prompt_hash: string;
  prompt_version: string;
  raw_output?: string;
  scenario: string;
  schema?: unknown;
  system_prompt?: string;
  /** Unique id of the tracing row in the DB. Used by the store to build the key. */
  tracing_id: string;
  validation_failed?: boolean;
  version: '1.0';
}

export interface TracingSummary {
  created_at: number;
  latency_ms?: number;
  model?: string;
  prompt_version: string;
  scenario: string;
  success: boolean;
  tracing_id: string;
  validation_failed?: boolean;
}

export interface ScenarioDefinition {
  /** Human-bumped prompt version (e.g. `v1.0`). */
  promptVersion: string;
  /** Symbolic scenario name, used for grouping and partitioning storage. */
  scenario: string;
}
