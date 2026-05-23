import { and, desc, eq } from 'drizzle-orm';

import type {
  LlmGenerationFeedbackSignal,
  LlmGenerationFeedbackSource,
  NewLlmGenerationTracing,
} from '../schemas/llmGenerationTracing';
import { llmGenerationTracing } from '../schemas/llmGenerationTracing';
import type { LobeChatDatabase } from '../type';

export interface RecordLlmGenerationParams {
  agentId?: string | null;
  costUsd?: number | null;
  errorCode?: string | null;
  errorDetail?: string | null;
  /**
   * Caller-supplied row id. When omitted the DB autogenerates one. Pass an
   * explicit UUID when the id needs to be known **before** the insert
   * completes (e.g. so a tRPC route can return it in the response and the
   * client can wire feedback against it).
   */
  id?: string;
  inputHash?: string | null;
  inputHint?: string | null;
  inputTokens?: number | null;
  latencyMs?: number | null;
  metadata?: Record<string, unknown>;
  model?: string | null;
  outputTokens?: number | null;
  parentTracingId?: string | null;
  promptHash: string;
  promptVersion: string;
  provider?: string | null;
  scenario: string;
  schemaName?: string | null;
  spanId?: string | null;
  storageKey?: string | null;
  success: boolean;
  topicId?: string | null;
  traceId?: string | null;
  trigger?: string | null;
  validationFailed?: boolean;
}

export interface UpdateLlmGenerationFeedbackParams {
  data?: Record<string, unknown>;
  score?: number | null;
  signal: LlmGenerationFeedbackSignal;
  source: LlmGenerationFeedbackSource;
}

export class LlmGenerationTracingModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  async record(params: RecordLlmGenerationParams): Promise<{ id: string }> {
    const values: NewLlmGenerationTracing = {
      agentId: params.agentId ?? null,
      costUsd: params.costUsd ?? null,
      errorCode: params.errorCode ?? null,
      errorDetail: params.errorDetail ?? null,
      ...(params.id ? { id: params.id } : {}),
      inputHash: params.inputHash ?? null,
      inputHint: params.inputHint ?? null,
      inputTokens: params.inputTokens ?? null,
      latencyMs: params.latencyMs ?? null,
      metadata: params.metadata ?? {},
      model: params.model ?? null,
      outputTokens: params.outputTokens ?? null,
      parentTracingId: params.parentTracingId ?? null,
      promptHash: params.promptHash,
      promptVersion: params.promptVersion,
      provider: params.provider ?? null,
      scenario: params.scenario,
      schemaName: params.schemaName ?? null,
      spanId: params.spanId ?? null,
      storageKey: params.storageKey ?? null,
      success: params.success,
      topicId: params.topicId ?? null,
      traceId: params.traceId ?? null,
      trigger: params.trigger ?? null,
      userId: this.userId,
      validationFailed: params.validationFailed ?? false,
    };

    const [row] = await this.db
      .insert(llmGenerationTracing)
      .values(values)
      .returning({ id: llmGenerationTracing.id });

    return { id: row.id };
  }

  /**
   * Returns `{ updated: true }` when a row matched `id + this.userId` and was
   * patched. `{ updated: false }` means no row matched — either the id doesn't
   * exist, or it belongs to a different user. Callers (e.g. the tracing
   * service / tRPC router) must treat the `false` case as a NOT_FOUND so the
   * client doesn't see a misleading success.
   */
  async updateFeedback(
    id: string,
    params: UpdateLlmGenerationFeedbackParams,
  ): Promise<{ updated: boolean }> {
    const rows = await this.db
      .update(llmGenerationTracing)
      .set({
        feedbackData: params.data,
        feedbackScore: params.score ?? null,
        feedbackSignal: params.signal,
        feedbackSource: params.source,
        feedbackUpdatedAt: new Date(),
      })
      .where(and(eq(llmGenerationTracing.id, id), eq(llmGenerationTracing.userId, this.userId)))
      .returning({ id: llmGenerationTracing.id });
    return { updated: rows.length > 0 };
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(llmGenerationTracing)
      .where(and(eq(llmGenerationTracing.id, id), eq(llmGenerationTracing.userId, this.userId)))
      .limit(1);
    return row ?? null;
  }

  async listRecent(limit = 50) {
    return this.db
      .select()
      .from(llmGenerationTracing)
      .where(eq(llmGenerationTracing.userId, this.userId))
      .orderBy(desc(llmGenerationTracing.createdAt))
      .limit(limit);
  }
}
