import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamptz } from './_helpers';
import { workspaces } from './workspace';

export type LlmGenerationErrorCode =
  | 'timeout'
  | 'validation_failed'
  | 'model_error'
  | 'quota_exceeded'
  | string;

export type LlmGenerationFeedbackSignal = 'positive' | 'negative' | 'neutral';

export type LlmGenerationFeedbackSource =
  | 'explicit_thumbs'
  | 'implicit_regenerate'
  | 'downstream_acceptance'
  | 'manual_edit'
  | 'usage_in_followup'
  | string;

export const llmGenerationTracing = pgTable(
  'llm_generation_tracing',
  {
    // ---- Identity & Version ----
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    /** Logical scenario: home_brief / agent_welcome / memory_extract / signal_skill_intent ... */
    scenario: text('scenario').notNull(),
    /** Human-bumped version, e.g. `v1.0`. Lives in TRACING_SCENARIO_REGISTRY. */
    promptVersion: text('prompt_version').notNull(),
    /** 6-char sha256 hash of `systemPrompt + JSON(schema)` — guards against forgotten version bumps. */
    promptHash: text('prompt_hash').notNull(),
    /** Symbolic name of the zod schema, e.g. `HomeBriefOutputSchema`. */
    schemaName: text('schema_name'),

    // ---- Context ----
    /**
     * Preserved across user deletion — tracing rows are audit/analytic data.
     * Intentionally not a foreign key.
     */
    userId: text('user_id').notNull(),
    agentId: text('agent_id'),
    topicId: text('topic_id'),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Maps to RequestTrigger enum. */
    trigger: text('trigger'),
    /** Self-reference for chained generateObject calls (e.g. memory job → multiple calls). */
    parentTracingId: uuid('parent_tracing_id'),

    // ---- Model ----
    provider: text('provider'),
    model: text('model'),

    // ---- Result ----
    success: boolean('success').notNull(),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    /** Zod validation failure signal — direct input to prompt iteration. */
    validationFailed: boolean('validation_failed').notNull().default(false),
    /** sha256 of normalized input — dedupe / cache-hit analysis. */
    inputHash: text('input_hash'),
    /** ≤200 chars of the first user message — list-page preview. */
    inputHint: text('input_hint'),

    // ---- Usage ----
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd', { mode: 'number', precision: 12, scale: 8 }),

    // ---- Storage Reference ----
    /** S3 key or local file path; null when no store was configured / store.save failed. */
    storageKey: text('storage_key'),

    // ---- Feedback (async backfill) ----
    feedbackSignal: text('feedback_signal'),
    feedbackScore: numeric('feedback_score', { mode: 'number', precision: 3, scale: 2 }),
    feedbackSource: text('feedback_source'),
    feedbackData: jsonb('feedback_data').$type<Record<string, unknown>>(),
    feedbackUpdatedAt: timestamp('feedback_updated_at', { withTimezone: true }),

    // ---- Audit ----
    traceId: text('trace_id'),
    spanId: text('span_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('llm_generation_tracing_scenario_idx').on(t.scenario),
    index('llm_generation_tracing_prompt_version_idx').on(t.promptVersion),
    index('llm_generation_tracing_user_id_idx').on(t.userId),
    index('llm_generation_tracing_agent_id_idx').on(t.agentId),
    index('llm_generation_tracing_topic_id_idx').on(t.topicId),
    index('llm_generation_tracing_workspace_id_idx').on(t.workspaceId),
    index('llm_generation_tracing_provider_idx').on(t.provider),
    index('llm_generation_tracing_model_idx').on(t.model),
    index('llm_generation_tracing_success_idx').on(t.success),
    index('llm_generation_tracing_error_code_idx').on(t.errorCode),
    index('llm_generation_tracing_validation_failed_idx').on(t.validationFailed),
    index('llm_generation_tracing_feedback_signal_idx').on(t.feedbackSignal),
    index('llm_generation_tracing_created_at_idx').on(t.createdAt),
  ],
);

export type NewLlmGenerationTracing = typeof llmGenerationTracing.$inferInsert;
export type LlmGenerationTracingItem = typeof llmGenerationTracing.$inferSelect;
