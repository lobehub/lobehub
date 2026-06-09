// @vitest-environment node
import type { ITracingStore, TracingPayload } from '@lobechat/llm-generation-tracing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { llmGenerationTracing, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { LLMGenerationTracingService } from './index';

const serverDB: LobeChatDatabase = await getTestDB();

// The service resolves the DB via getServerDB at call time. Point it at our
// test DB so the integration covers the real insert/update path.
vi.mock('@/database/server', () => ({ getServerDB: async () => serverDB }));

const userId = 'llm-gen-trace-svc-user';

const stubStore: ITracingStore & {
  save: ReturnType<typeof vi.fn<(record: TracingPayload) => Promise<{ key: string | null }>>>;
} = {
  save: vi.fn<(record: TracingPayload) => Promise<{ key: string | null }>>(async () => ({
    key: 'memo://saved',
  })),
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  stubStore.save.mockClear();
  stubStore.save.mockResolvedValue({ key: 'memo://saved' });
});

afterEach(async () => {
  await serverDB.delete(llmGenerationTracing);
  await serverDB.delete(users);
});

describe('LLMGenerationTracingService.record', () => {
  it('inserts a row, calls the store, and patches the returned storage_key', async () => {
    const service = new LLMGenerationTracingService(stubStore);

    const result = await service.record({
      latencyMs: 420,
      model: 'gpt-4o',
      payload: {
        input: [{ content: 'hello world from the user', role: 'user' }],
        output: { topic: 'greeting' },
        schema: { type: 'object' },
        systemPrompt: 'be helpful',
      },
      promptHash: 'aaaaaa',
      promptVersion: 'v1.0',
      provider: 'openai',
      scenario: 'home_brief',
      success: true,
      trigger: 'home_brief',
      userId,
    });

    expect(result?.tracingId).toMatch(/^[0-9a-f-]{36}$/);
    expect(stubStore.save).toHaveBeenCalledTimes(1);

    const payload = stubStore.save.mock.calls[0][0];
    expect(payload).toMatchObject({
      input: [{ content: 'hello world from the user', role: 'user' }],
      model_metadata: { model: 'gpt-4o', provider: 'openai' },
      output: { topic: 'greeting' },
      prompt_hash: 'aaaaaa',
      scenario: 'home_brief',
      tracing_id: result?.tracingId,
      version: '1.0',
    });

    const [row] = await serverDB
      .select()
      .from(llmGenerationTracing)
      .where(eq(llmGenerationTracing.id, result!.tracingId));
    expect(row).toMatchObject({
      inputHint: 'hello world from the user',
      latencyMs: 420,
      model: 'gpt-4o',
      promptHash: 'aaaaaa',
      provider: 'openai',
      scenario: 'home_brief',
      storageKey: 'memo://saved',
      success: true,
      trigger: 'home_brief',
      userId,
    });
    expect(row?.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preserves the row with storage_key=null and metadata.store_error when the store throws', async () => {
    stubStore.save.mockRejectedValueOnce(new Error('S3 5xx'));
    const service = new LLMGenerationTracingService(stubStore);

    const result = await service.record({
      metadata: { caller: 'home_brief_handler' },
      promptHash: 'bbbbbb',
      promptVersion: 'v1.0',
      scenario: 'home_brief',
      success: true,
      userId,
    });

    const [row] = await serverDB
      .select()
      .from(llmGenerationTracing)
      .where(eq(llmGenerationTracing.id, result!.tracingId));
    expect(row?.storageKey).toBeNull();
    expect(row?.metadata).toMatchObject({
      caller: 'home_brief_handler',
      store_error: 'S3 5xx',
    });
  });

  it('honours a caller-supplied tracingId as the row primary key', async () => {
    const service = new LLMGenerationTracingService(stubStore);
    const preAllocated = '00000000-0000-0000-0000-000000000abc';
    const result = await service.record({
      promptHash: 'ffffff',
      promptVersion: 'v1.0',
      scenario: 'input_completion',
      success: true,
      tracingId: preAllocated,
      userId,
    });

    expect(result?.tracingId).toBe(preAllocated);
    const [row] = await serverDB
      .select()
      .from(llmGenerationTracing)
      .where(eq(llmGenerationTracing.id, preAllocated));
    expect(row?.id).toBe(preAllocated);
  });

  it('honours an explicit inputHint override instead of auto-extracting from the first user message', async () => {
    const service = new LLMGenerationTracingService(stubStore);
    const result = await service.record({
      inputHint: '杭州天气',
      payload: {
        // Wrapper prompt — first user message is a template, not the real input.
        input: [
          { content: 'be helpful', role: 'system' },
          { content: 'Before cursor: "杭州天气" After cursor: ""', role: 'user' },
        ],
      },
      promptHash: 'ffffff',
      promptVersion: 'v1.0',
      scenario: 'input_completion',
      success: true,
      userId,
    });

    const [row] = await serverDB
      .select()
      .from(llmGenerationTracing)
      .where(eq(llmGenerationTracing.id, result!.tracingId));
    expect(row?.inputHint).toBe('杭州天气');
  });

  it('truncates an excessively long inputHint override to INPUT_HINT_MAX', async () => {
    const service = new LLMGenerationTracingService(stubStore);
    const long = 'x'.repeat(500);
    const result = await service.record({
      inputHint: long,
      promptHash: 'ffffff',
      promptVersion: 'v1.0',
      scenario: 'input_completion',
      success: true,
      userId,
    });
    const [row] = await serverDB
      .select()
      .from(llmGenerationTracing)
      .where(eq(llmGenerationTracing.id, result!.tracingId));
    expect(row?.inputHint?.length).toBe(200);
  });

  it('leaves storage_key null when the store reports a local-only save (key=null)', async () => {
    stubStore.save.mockResolvedValueOnce({ key: null });
    const service = new LLMGenerationTracingService(stubStore);

    const result = await service.record({
      promptHash: 'eeeeee',
      promptVersion: 'v1.0',
      scenario: 'home_brief',
      success: true,
      userId,
    });

    const [row] = await serverDB
      .select()
      .from(llmGenerationTracing)
      .where(eq(llmGenerationTracing.id, result!.tracingId));
    expect(row?.storageKey).toBeNull();
  });

  it('returns null and skips everything when no store is configured', async () => {
    const service = new LLMGenerationTracingService(null);
    const result = await service.record({
      promptHash: 'cccccc',
      promptVersion: 'v1.0',
      scenario: 'home_brief',
      success: true,
      userId,
    });
    expect(result).toBeNull();
    expect(stubStore.save).not.toHaveBeenCalled();
    const rows = await serverDB.select().from(llmGenerationTracing);
    expect(rows).toHaveLength(0);
  });
});

describe('LLMGenerationTracingService.recordFeedback', () => {
  it('writes feedback columns onto the row owned by the caller', async () => {
    const service = new LLMGenerationTracingService(stubStore);

    const { tracingId } = (await service.record({
      promptHash: 'dddddd',
      promptVersion: 'v1.0',
      scenario: 'agent_welcome',
      success: true,
      userId,
    }))!;

    await service.recordFeedback(userId, tracingId, {
      data: { clicked_question_index: 0 },
      score: 1,
      signal: 'positive',
      source: 'explicit_thumbs',
    });

    const [row] = await serverDB
      .select()
      .from(llmGenerationTracing)
      .where(eq(llmGenerationTracing.id, tracingId));
    expect(row).toMatchObject({
      feedbackData: { clicked_question_index: 0 },
      feedbackScore: 1,
      feedbackSignal: 'positive',
      feedbackSource: 'explicit_thumbs',
    });
  });

  it('throws LLMGenerationFeedbackError(not_found) when no row matches the tracingId', async () => {
    const service = new LLMGenerationTracingService(stubStore);
    await expect(
      service.recordFeedback(userId, '00000000-0000-0000-0000-000000000abc', {
        signal: 'positive',
        source: 'explicit_thumbs',
      }),
    ).rejects.toMatchObject({
      kind: 'not_found',
      name: 'LLMGenerationFeedbackError',
    });
  });

  it('throws LLMGenerationFeedbackError(not_found) when the row belongs to another user', async () => {
    const service = new LLMGenerationTracingService(stubStore);
    const { tracingId } = (await service.record({
      promptHash: 'cafecafe',
      promptVersion: 'v1.0',
      scenario: 'agent_welcome',
      success: true,
      userId,
    }))!;

    await expect(
      service.recordFeedback('some-other-user', tracingId, {
        signal: 'negative',
        source: 'manual_edit',
      }),
    ).rejects.toMatchObject({
      kind: 'not_found',
      name: 'LLMGenerationFeedbackError',
    });
  });
});
