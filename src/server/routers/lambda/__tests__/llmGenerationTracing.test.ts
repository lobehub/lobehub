// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const recordFeedback = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});

vi.mock('@/server/services/llmGenerationTracing', () => ({
  getLLMGenerationTracingService: () => ({ recordFeedback }),
}));

const { llmGenerationTracingRouter } = await import('../llmGenerationTracing');

const mockCtx = { userId: 'u1' };

describe('llmGenerationTracingRouter.recordFeedback', () => {
  it('forwards { tracingId, signal, source, score, data } through to the service', async () => {
    recordFeedback.mockClear();
    const caller = llmGenerationTracingRouter.createCaller(mockCtx as any);
    const tracingId = '00000000-0000-0000-0000-000000000001';

    const result = await caller.recordFeedback({
      data: { accepted_text: 'hello' },
      score: 1,
      signal: 'positive',
      source: 'explicit_thumbs',
      tracingId,
    });

    expect(result).toEqual({ ok: true });
    expect(recordFeedback).toHaveBeenCalledWith('u1', tracingId, {
      data: { accepted_text: 'hello' },
      score: 1,
      signal: 'positive',
      source: 'explicit_thumbs',
    });
  });

  it('rejects an invalid signal value', async () => {
    const caller = llmGenerationTracingRouter.createCaller(mockCtx as any);
    await expect(
      caller.recordFeedback({
        signal: 'meh' as any,
        source: 'explicit_thumbs',
        tracingId: '00000000-0000-0000-0000-000000000001',
      }),
    ).rejects.toThrow();
  });

  it('rejects a malformed tracingId', async () => {
    const caller = llmGenerationTracingRouter.createCaller(mockCtx as any);
    await expect(
      caller.recordFeedback({
        signal: 'positive',
        source: 'explicit_thumbs',
        tracingId: 'not-a-uuid',
      }),
    ).rejects.toThrow();
  });

  it('rejects an out-of-range score', async () => {
    const caller = llmGenerationTracingRouter.createCaller(mockCtx as any);
    await expect(
      caller.recordFeedback({
        score: 2,
        signal: 'positive',
        source: 'explicit_thumbs',
        tracingId: '00000000-0000-0000-0000-000000000001',
      }),
    ).rejects.toThrow();
  });
});
