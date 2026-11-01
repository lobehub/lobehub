// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import type * as TracingService from '@/server/services/llmGenerationTracing';

const recordFeedback = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});

// Mock the service module but keep the real `LLMGenerationFeedbackError` class —
// the router does an `instanceof` check, so the constructor reference must match.
vi.mock('@/server/services/llmGenerationTracing', async () => {
  const actual = await vi.importActual<typeof TracingService>(
    '@/server/services/llmGenerationTracing',
  );
  return {
    ...actual,
    getLLMGenerationTracingService: () => ({ recordFeedback }),
  };
});

const { llmGenerationTracingRouter } = await import('../llmGenerationTracing');
const { LLMGenerationFeedbackError } = await import('@/server/services/llmGenerationTracing');

const mockCtx = { userId: 'u1' };

describe('llmGenerationTracingRouter.recordFeedback', () => {
  it('forwards { tracingId, signal, source, score, data } through to the service', async () => {
    recordFeedback.mockClear();
    recordFeedback.mockResolvedValueOnce(undefined);
    const caller = llmGenerationTracingRouter.createCaller(mockCtx as any);
    const tracingId = '00000000-0000-4000-8000-000000000001';

    const result = await caller.recordFeedback({
      data: { accepted_text: 'hello' },
      score: 1,
      signal: 'positive',
      source: 'explicit_thumbs',
      tracingId,
    });

    expect(result).toEqual({ ok: true });
    expect(recordFeedback).toHaveBeenCalledWith(
      'u1',
      tracingId,
      {
        data: { accepted_text: 'hello' },
        score: 1,
        signal: 'positive',
        source: 'explicit_thumbs',
      },
      undefined,
    );
  });

  it('translates LLMGenerationFeedbackError(not_found) into TRPCError NOT_FOUND', async () => {
    recordFeedback.mockClear();
    recordFeedback.mockRejectedValueOnce(
      new LLMGenerationFeedbackError('not_found', 'no tracing row matched id=…'),
    );
    const caller = llmGenerationTracingRouter.createCaller(mockCtx as any);
    try {
      await caller.recordFeedback({
        signal: 'positive',
        source: 'explicit_thumbs',
        tracingId: '00000000-0000-4000-8000-000000000001',
      });
      throw new Error('expected mutation to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('NOT_FOUND');
    }
  });

  it('translates LLMGenerationFeedbackError(db_failure) into TRPCError INTERNAL_SERVER_ERROR', async () => {
    recordFeedback.mockClear();
    recordFeedback.mockRejectedValueOnce(
      new LLMGenerationFeedbackError('db_failure', 'database not reachable'),
    );
    const caller = llmGenerationTracingRouter.createCaller(mockCtx as any);
    try {
      await caller.recordFeedback({
        signal: 'positive',
        source: 'explicit_thumbs',
        tracingId: '00000000-0000-4000-8000-000000000001',
      });
      throw new Error('expected mutation to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('INTERNAL_SERVER_ERROR');
    }
  });

  it('rejects an invalid signal value', async () => {
    const caller = llmGenerationTracingRouter.createCaller(mockCtx as any);
    await expect(
      caller.recordFeedback({
        signal: 'meh' as any,
        source: 'explicit_thumbs',
        tracingId: '00000000-0000-4000-8000-000000000001',
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
        tracingId: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toThrow();
  });
});
