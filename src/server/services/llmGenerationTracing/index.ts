import { randomUUID } from 'node:crypto';

import {
  computeInputHash,
  FileTracingStore,
  type ITracingStore,
  type TracingPayload,
} from '@lobechat/llm-generation-tracing';
import debug from 'debug';
import { eq } from 'drizzle-orm';

import {
  LlmGenerationTracingModel,
  type RecordLlmGenerationParams,
  type UpdateLlmGenerationFeedbackParams,
} from '@/database/models/llmGenerationTracing';
import { llmGenerationTracing } from '@/database/schemas/llmGenerationTracing';
import { getServerDB } from '@/database/server';

const log = debug('lobe-server:llm-generation-tracing:service');

const INPUT_HINT_MAX = 200;

export interface GenerationCallPayload {
  input?: unknown;
  output?: unknown;
  rawOutput?: string;
  schema?: unknown;
  systemPrompt?: string;
}

export interface RecordLLMGenerationCallParams {
  agentId?: string | null;
  costUsd?: number | null;
  errorCode?: string | null;
  errorDetail?: string | null;
  /**
   * Caller-supplied snippet stored on `input_hint`. When omitted, the service
   * auto-extracts a hint from the first user message in `payload.input`.
   * Callers wrapping the user's text in a template should pass the raw input
   * here so the DB row stays human-scannable.
   */
  inputHint?: string | null;
  inputTokens?: number | null;
  latencyMs?: number | null;
  metadata?: Record<string, unknown>;
  model?: string | null;
  outputTokens?: number | null;
  parentTracingId?: string | null;
  payload?: GenerationCallPayload;
  promptHash: string;
  promptVersion: string;
  provider?: string | null;
  scenario: string;
  schemaName?: string | null;
  spanId?: string | null;
  success: boolean;
  topicId?: string | null;
  traceId?: string | null;
  /**
   * Caller-supplied UUID for the row. When omitted the service generates one
   * up-front (before DB insert), so the id is always known and returnable
   * synchronously to the calling route.
   */
  tracingId?: string;
  trigger?: string | null;
  userId: string;
  validationFailed?: boolean;
  workspaceId?: string | null;
}

/**
 * Per-call observability for `generateObject`. Persists a structured summary
 * row to `llm_generation_tracing` and the full prompt/input/output blob to the
 * configured store (S3 in prod, local file in dev, no-op otherwise).
 *
 * Always invoked from `after()` so it never blocks the user response. Both
 * store and DB failures are swallowed and logged — the DB row is the source
 * of truth for analytics, the blob is a cold artefact for offline review.
 */
export class LLMGenerationTracingService {
  private readonly store: ITracingStore | null;

  constructor(store?: ITracingStore | null) {
    this.store = store === undefined ? createDefaultStore() : store;
  }

  isEnabled(): boolean {
    return this.store !== null;
  }

  async record(params: RecordLLMGenerationCallParams): Promise<{ tracingId: string } | null> {
    if (!this.store) return null;

    let db: Awaited<ReturnType<typeof getServerDB>>;
    try {
      db = await getServerDB();
    } catch (err) {
      log('Skipping tracing — getServerDB failed: %O', err);
      return null;
    }

    const model = new LlmGenerationTracingModel(db, params.userId, params.workspaceId ?? undefined);

    // Allocate the id up-front so the route can return it synchronously to
    // the client (e.g. for feedback wiring) even though the actual `record()`
    // call runs inside Next's `after()` after the response has been sent.
    const id = params.tracingId ?? randomUUID();

    const dbValues: RecordLlmGenerationParams = {
      agentId: params.agentId,
      costUsd: params.costUsd,
      errorCode: params.errorCode,
      errorDetail: params.errorDetail,
      id,
      inputHash: params.payload?.input ? computeInputHash(params.payload.input) : null,
      inputHint: resolveInputHint(params.inputHint, params.payload?.input),
      inputTokens: params.inputTokens,
      latencyMs: params.latencyMs,
      metadata: params.metadata,
      model: params.model,
      outputTokens: params.outputTokens,
      parentTracingId: params.parentTracingId,
      promptHash: params.promptHash,
      promptVersion: params.promptVersion,
      provider: params.provider,
      scenario: params.scenario,
      schemaName: params.schemaName,
      spanId: params.spanId,
      success: params.success,
      topicId: params.topicId,
      traceId: params.traceId,
      trigger: params.trigger,
      validationFailed: params.validationFailed,
    };

    // `id` was already allocated up-front (caller-supplied or randomUUID()).
    // Insert first so the storage key can embed the row's id — every blob
    // then points at exactly one row.
    try {
      await model.record(dbValues);
    } catch (err) {
      log('DB insert failed: %O', err);
      return null;
    }

    const payload: TracingPayload = {
      created_at: Date.now(),
      error: params.success
        ? undefined
        : {
            code: params.errorCode ?? undefined,
            message: params.errorDetail ?? undefined,
          },
      input: params.payload?.input,
      model_metadata: {
        model: params.model ?? undefined,
        provider: params.provider ?? undefined,
      },
      output: params.payload?.output,
      prompt_hash: params.promptHash,
      prompt_version: params.promptVersion,
      raw_output: params.validationFailed ? params.payload?.rawOutput : undefined,
      scenario: params.scenario,
      schema: params.payload?.schema,
      system_prompt: params.payload?.systemPrompt,
      tracing_id: id,
      validation_failed: params.validationFailed,
      version: '1.0',
    };

    let storageKey: string | null = null;
    let storeError: string | undefined;
    try {
      const result = await this.store.save(payload);
      storageKey = result.key;
    } catch (err) {
      storeError = err instanceof Error ? err.message : String(err);
      log('Store save failed (DB row kept): %O', err);
    }

    try {
      await db
        .update(llmGenerationTracing)
        .set({
          metadata: storeError
            ? { ...params.metadata, store_error: storeError }
            : (params.metadata ?? {}),
          storageKey,
        })
        .where(eq(llmGenerationTracing.id, id));
    } catch (err) {
      log('Failed to patch storage_key onto row: %O', err);
    }

    return { tracingId: id };
  }

  /**
   * Write a feedback row to `llm_generation_tracing`. Surfaces failures so
   * callers can distinguish "actually persisted" from "silently dropped":
   *
   * - DB init / update throws → `LLMGenerationFeedbackError({ kind: 'db_failure' })`
   * - WHERE matched no row (wrong id, or row owned by another user) →
   *   `LLMGenerationFeedbackError({ kind: 'not_found' })`
   *
   * The tRPC route translates these into `INTERNAL_SERVER_ERROR` /
   * `NOT_FOUND` so the client can choose retry vs give-up semantics.
   */
  async recordFeedback(
    userId: string,
    tracingId: string,
    params: UpdateLlmGenerationFeedbackParams,
    workspaceId?: string,
  ): Promise<void> {
    let db: Awaited<ReturnType<typeof getServerDB>>;
    try {
      db = await getServerDB();
    } catch (err) {
      log('Feedback DB init failed: %O', err);
      throw new LLMGenerationFeedbackError('db_failure', 'database not reachable', {
        cause: err,
      });
    }
    const model = new LlmGenerationTracingModel(db, userId, workspaceId);
    let result: { updated: boolean };
    try {
      result = await model.updateFeedback(tracingId, params);
    } catch (err) {
      log('Feedback update failed: %O', err);
      throw new LLMGenerationFeedbackError('db_failure', 'database update failed', {
        cause: err,
      });
    }
    if (!result.updated) {
      log('Feedback update affected 0 rows (id=%s userId=%s)', tracingId, userId);
      throw new LLMGenerationFeedbackError(
        'not_found',
        `no tracing row matched id=${tracingId} for the calling user`,
      );
    }
  }
}

/**
 * Typed failure for `recordFeedback`. `kind` discriminates between an absent
 * row (caller probably retrying with a wrong id or wrong user) and an actual
 * DB outage (caller may want to retry).
 */
export class LLMGenerationFeedbackError extends Error {
  readonly kind: 'not_found' | 'db_failure';

  constructor(kind: 'not_found' | 'db_failure', message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LLMGenerationFeedbackError';
    this.kind = kind;
  }
}

const createDefaultStore = (): ITracingStore | null => {
  if (process.env.ENABLE_LLM_GENERATION_TRACING_S3 === '1') {
    try {
      // Require at call time so test environments without S3 wiring don't break.

      const { S3TracingStore } = require('@/server/modules/LLMGenerationTracing');
      return new S3TracingStore();
    } catch {
      // S3 wiring not available — fall through to file store / null.
    }
  }

  if (process.env.NODE_ENV === 'development') {
    try {
      return new FileTracingStore();
    } catch {
      // Filesystem unavailable — fall through to null.
    }
  }

  return null;
};

const autoExtractHint = (input: unknown): string | null => {
  if (input == null) return null;
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) return null;
  const firstUser = input.find(
    (m): m is { content: unknown; role: string } =>
      typeof m === 'object' &&
      m !== null &&
      'role' in m &&
      (m as { role: unknown }).role === 'user',
  );
  return firstUser && typeof firstUser.content === 'string' ? firstUser.content : null;
};

/**
 * Pick the `input_hint` value: caller-supplied override wins; otherwise fall
 * back to a best-effort auto-extraction from the first user message. Always
 * truncated to `INPUT_HINT_MAX` so the column stays scannable.
 */
const resolveInputHint = (override: string | null | undefined, input: unknown): string | null => {
  const raw = override ?? autoExtractHint(input);
  if (raw == null) return null;
  return raw.slice(0, INPUT_HINT_MAX);
};

let cachedInstance: LLMGenerationTracingService | null = null;
export const getLLMGenerationTracingService = (): LLMGenerationTracingService => {
  if (!cachedInstance) cachedInstance = new LLMGenerationTracingService();
  return cachedInstance;
};
