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

/**
 * Caller-facing tracing config for a single `generateObject` call. Passed
 * through `GenerateObjectOptions.tracing` and consumed by the tracing hook
 * to populate the `llm_generation_tracing` DB row + off-DB blob.
 *
 * Every field is optional — the hook fills sensible defaults (auto-extracted
 * `inputHint`, registry-resolved `scenario`, `messages[0]` as system prompt).
 * Supply the fields explicitly to keep the DB row scannable.
 */
export interface TracingOptions {
  /** Owning agent ID; persisted to `agent_id`. */
  agentId?: string;
  /**
   * Short snippet stored on `input_hint`. Pass the user's actual typed text
   * when the prompt wraps it in a template — otherwise the auto-extracted
   * hint ends up being the wrapper's first user message (e.g.
   * `Before cursor: "…" After cursor: "…"`) instead of what the user wrote.
   */
  inputHint?: string;
  /**
   * Free-form context written to the row's `metadata` jsonb column. Use this
   * for ad-hoc fields that don't deserve a typed slot (e.g. correlation IDs).
   */
  metadata?: Record<string, unknown>;
  /** Parent tracing row for chained generations. */
  parentTracingId?: string;
  /** Semantic prompt version (e.g. `v1.0`). */
  promptVersion?: string;
  /** Scenario name; falls back to registry lookup by `trigger`. */
  scenario?: string;
  /** Structured-output schema identifier. */
  schemaName?: string;
  /**
   * Override for the prompt-hash system text. Defaults to `messages[0]`
   * when it's a system message.
   */
  systemPrompt?: string;
  /** Topic / conversation ID. */
  topicId?: string;
  /**
   * Caller-supplied UUID used as the tracing row's primary key. Pass this
   * when the id needs to be known **before** the generation completes —
   * e.g. so the calling route can return it in the response and the client
   * can later post feedback against it. Omit to let the service generate one.
   */
  tracingId?: string;
  /** RequestTrigger string. */
  trigger?: string;
}
