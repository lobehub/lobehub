// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isEnabled = vi.fn<() => boolean>(() => true);
const record = vi.fn<(params: Record<string, unknown>) => Promise<{ tracingId: string }>>(
  async () => ({ tracingId: 'trace-1' }),
);

vi.mock('./index', () => ({
  getLLMGenerationTracingService: () => ({ isEnabled, record }),
}));

// next/server is optional at runtime; default to "not available" so the hook
// falls back to its microtask path which is straightforward to test.
vi.mock('next/server', () => ({}));

const { createLLMGenerationTracingHook } = await import('./hook');

const flushMicrotasks = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(() => {
  isEnabled.mockReturnValue(true);
  record.mockClear();
});

describe('createLLMGenerationTracingHook', () => {
  it('returns an empty object when the service is disabled', () => {
    isEnabled.mockReturnValue(false);
    const hooks = createLLMGenerationTracingHook('user-1', 'openai');
    expect(hooks).toEqual({});
  });

  it('schedules a service.record call on success, reading structured tracing config from options.tracing', async () => {
    const hooks = createLLMGenerationTracingHook('user-1', 'openai');
    expect(hooks.onGenerateObjectComplete).toBeDefined();

    hooks.onGenerateObjectComplete!(
      {
        latencyMs: 250,
        output: { topic: 'greeting' },
        success: true,
        usage: { cost: 0.001, totalInputTokens: 100, totalOutputTokens: 30 } as any,
      },
      {
        options: {
          metadata: { trigger: 'agent_signal' },
          tracing: {
            agentId: 'agt-1',
            promptVersion: 'v2.0',
            scenario: 'signal_skill_intent',
            topicId: 'tpc-1',
          },
        },
        payload: {
          messages: [
            { content: 'be helpful', role: 'system' },
            { content: 'hi there', role: 'user' },
          ],
          model: 'gpt-4o',
          schema: { type: 'object' },
        } as any,
      },
    );

    await flushMicrotasks();
    expect(record).toHaveBeenCalledTimes(1);
    const call = record.mock.calls[0][0];
    expect(call).toMatchObject({
      agentId: 'agt-1',
      costUsd: 0.001,
      inputTokens: 100,
      latencyMs: 250,
      model: 'gpt-4o',
      outputTokens: 30,
      promptVersion: 'v2.0',
      provider: 'openai',
      scenario: 'signal_skill_intent',
      success: true,
      topicId: 'tpc-1',
      trigger: 'agent_signal',
      userId: 'user-1',
    });
    expect((call.payload as { systemPrompt?: string }).systemPrompt).toBe('be helpful');
    expect(call.promptHash).toHaveLength(6);
  });

  it('forwards caller-supplied inputHint through to the service', async () => {
    const hooks = createLLMGenerationTracingHook('user-1', 'openai');
    hooks.onGenerateObjectComplete!(
      { latencyMs: 10, success: true },
      {
        options: {
          tracing: {
            inputHint: '杭州天气',
            scenario: 'input_completion',
            schemaName: 'InputCompletion',
          },
        },
        payload: { messages: [], model: 'gpt-4o', schema: {} } as any,
      },
    );
    await flushMicrotasks();
    expect(record.mock.calls[0][0]).toMatchObject({
      inputHint: '杭州天气',
      scenario: 'input_completion',
      schemaName: 'InputCompletion',
    });
  });

  it('flags validation failures using the error message heuristic and resolves scenario from metadata.trigger fallback', async () => {
    const hooks = createLLMGenerationTracingHook('user-1', 'openai');
    hooks.onGenerateObjectComplete!(
      {
        error: { message: 'ZodError: required field missing' },
        latencyMs: 100,
        success: false,
      },
      {
        options: { metadata: { trigger: 'topic' } },
        payload: { messages: [], model: 'gpt-4o', schema: { type: 'object' } } as any,
      },
    );

    await flushMicrotasks();
    expect(record.mock.calls[0][0]).toMatchObject({
      errorDetail: 'ZodError: required field missing',
      scenario: 'topic_title',
      success: false,
      trigger: 'topic',
      validationFailed: true,
    });
  });

  it('writes caller-supplied tracing.metadata verbatim to the DB jsonb column (no auto-stamped provider)', async () => {
    const hooks = createLLMGenerationTracingHook('user-1', 'openai');
    hooks.onGenerateObjectComplete!(
      { latencyMs: 5, success: true },
      {
        options: {
          metadata: { trigger: 'memory' },
          tracing: {
            agentId: 'agt-known',
            metadata: {
              parent_memory_trace_key: 'memory-extraction/user-1/topic/abc/trace/2026-05-22.json',
            },
          },
        },
        payload: { messages: [], model: 'gpt-4o', schema: {} } as any,
      },
    );
    await flushMicrotasks();
    // `provider` is a first-class column — must NOT be duplicated into metadata.
    expect(record.mock.calls[0][0].metadata).toEqual({
      parent_memory_trace_key: 'memory-extraction/user-1/topic/abc/trace/2026-05-22.json',
    });
  });

  it('omits the metadata field when the caller passes no tracing.metadata', async () => {
    const hooks = createLLMGenerationTracingHook('user-1', 'openai');
    hooks.onGenerateObjectComplete!(
      { latencyMs: 5, success: true },
      {
        options: { tracing: { scenario: 'input_completion' } },
        payload: { messages: [], model: 'gpt-4o', schema: {} } as any,
      },
    );
    await flushMicrotasks();
    expect(record.mock.calls[0][0].metadata).toBeUndefined();
  });

  it('falls back to the unknown scenario when no trigger / scenario is provided anywhere', async () => {
    const hooks = createLLMGenerationTracingHook('user-1', 'openai');
    hooks.onGenerateObjectComplete!(
      { latencyMs: 100, success: true },
      { options: {}, payload: { messages: [], model: 'gpt-4o' } as any },
    );

    await flushMicrotasks();
    expect(record.mock.calls[0][0]).toMatchObject({
      promptVersion: 'v0',
      scenario: 'unknown',
    });
  });
});
