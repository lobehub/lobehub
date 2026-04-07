import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayStreamNotifier } from '../GatewayStreamNotifier';
import type { StreamChunkData } from '../StreamEventManager';
import type { IStreamEventManager } from '../types';

// Mock global fetch
const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
vi.stubGlobal('fetch', mockFetch);

function createMockInner(): IStreamEventManager & { calls: Record<string, any[][]> } {
  const calls: Record<string, any[][]> = {};

  const track = (name: string) => {
    calls[name] = [];
    return (...args: any[]) => {
      calls[name].push(args);
      return Promise.resolve(`${name}-result`);
    };
  };

  return {
    calls,
    cleanupOperation: track('cleanupOperation') as any,
    disconnect: track('disconnect') as any,
    getActiveOperationsCount: track('getActiveOperationsCount') as any,
    getStreamHistory: track('getStreamHistory') as any,
    publishAgentRuntimeEnd: track('publishAgentRuntimeEnd') as any,
    publishAgentRuntimeInit: track('publishAgentRuntimeInit') as any,
    publishStreamChunk: track('publishStreamChunk') as any,
    publishStreamEvent: track('publishStreamEvent') as any,
    subscribeStreamEvents: track('subscribeStreamEvents') as any,
  };
}

describe('GatewayStreamNotifier', () => {
  let inner: ReturnType<typeof createMockInner>;
  let notifier: GatewayStreamNotifier;
  const gatewayUrl = 'https://gateway.test.com';
  const serviceToken = 'test-token';

  beforeEach(() => {
    vi.clearAllMocks();
    inner = createMockInner();
    notifier = new GatewayStreamNotifier(inner, gatewayUrl, serviceToken);
  });

  // ─── Publish methods: must always call inner first ───

  describe('publishStreamEvent', () => {
    it('delegates to inner and returns its result', async () => {
      const event = { data: { foo: 'bar' }, stepIndex: 0, type: 'step_start' as const };

      const result = await notifier.publishStreamEvent('op-1', event);

      expect(result).toBe('publishStreamEvent-result');
      expect(inner.calls.publishStreamEvent).toHaveLength(1);
      expect(inner.calls.publishStreamEvent[0]).toEqual(['op-1', event]);
    });

    it('pushes event to gateway via HTTP', async () => {
      await notifier.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'step_start' as const,
      });

      // Wait for fire-and-forget
      await new Promise((r) => setTimeout(r, 50));

      expect(mockFetch).toHaveBeenCalledWith(
        `${gatewayUrl}/api/operations/push-event`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${serviceToken}`,
          }),
          method: 'POST',
        }),
      );
    });

    it('still returns inner result even if gateway fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));

      const result = await notifier.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'step_start' as const,
      });

      expect(result).toBe('publishStreamEvent-result');
      expect(inner.calls.publishStreamEvent).toHaveLength(1);
    });
  });

  describe('publishStreamChunk', () => {
    it('delegates to inner and returns its result', async () => {
      const chunkData: StreamChunkData = { chunkType: 'text', content: 'hello' };

      const result = await notifier.publishStreamChunk('op-1', 0, chunkData);

      expect(result).toBe('publishStreamChunk-result');
      expect(inner.calls.publishStreamChunk).toHaveLength(1);
      expect(inner.calls.publishStreamChunk[0]).toEqual(['op-1', 0, chunkData]);
    });
  });

  describe('publishAgentRuntimeInit', () => {
    it('delegates to inner and returns its result', async () => {
      const initialState = { userId: 'user-1' };

      const result = await notifier.publishAgentRuntimeInit('op-1', initialState);

      expect(result).toBe('publishAgentRuntimeInit-result');
      expect(inner.calls.publishAgentRuntimeInit).toHaveLength(1);
      expect(inner.calls.publishAgentRuntimeInit[0]).toEqual(['op-1', initialState]);
    });

    it('calls gateway init and push-event endpoints', async () => {
      await notifier.publishAgentRuntimeInit('op-1', { userId: 'user-1' });

      await new Promise((r) => setTimeout(r, 50));

      const urls = mockFetch.mock.calls.map((c: any[]) => c[0]);
      expect(urls).toContain(`${gatewayUrl}/api/operations/init`);
      expect(urls).toContain(`${gatewayUrl}/api/operations/push-event`);
    });
  });

  describe('publishAgentRuntimeEnd', () => {
    it('delegates to inner and returns its result', async () => {
      const finalState = { status: 'done' };

      const result = await notifier.publishAgentRuntimeEnd('op-1', 2, finalState, 'completed');

      expect(result).toBe('publishAgentRuntimeEnd-result');
      expect(inner.calls.publishAgentRuntimeEnd).toHaveLength(1);
      expect(inner.calls.publishAgentRuntimeEnd[0]).toEqual([
        'op-1',
        2,
        finalState,
        'completed',
        undefined,
      ]);
    });

    it('calls gateway push-event and update-status endpoints', async () => {
      await notifier.publishAgentRuntimeEnd('op-1', 2, {}, 'completed', 'All done');

      await new Promise((r) => setTimeout(r, 50));

      const urls = mockFetch.mock.calls.map((c: any[]) => c[0]);
      expect(urls).toContain(`${gatewayUrl}/api/operations/push-event`);
      expect(urls).toContain(`${gatewayUrl}/api/operations/update-status`);
    });

    it('maps error reason to error status', async () => {
      await notifier.publishAgentRuntimeEnd('op-1', 0, {}, 'error', 'Something broke');

      await new Promise((r) => setTimeout(r, 50));

      const statusCall = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === `${gatewayUrl}/api/operations/update-status`,
      );
      expect(statusCall).toBeDefined();
      const body = JSON.parse(statusCall![1].body);
      expect(body.status).toBe('error');
    });
  });

  // ─── Read/subscribe methods: must delegate directly to inner ───

  describe('subscribeStreamEvents', () => {
    it('delegates directly to inner', async () => {
      const onEvents = vi.fn();
      const signal = new AbortController().signal;

      await notifier.subscribeStreamEvents('op-1', '0', onEvents, signal);

      expect(inner.calls.subscribeStreamEvents).toHaveLength(1);
      expect(inner.calls.subscribeStreamEvents[0]).toEqual(['op-1', '0', onEvents, signal]);
    });

    it('does not call gateway', async () => {
      await notifier.subscribeStreamEvents('op-1', '0', vi.fn());

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('getStreamHistory', () => {
    it('delegates directly to inner', async () => {
      await notifier.getStreamHistory('op-1', 50);

      expect(inner.calls.getStreamHistory).toHaveLength(1);
      expect(inner.calls.getStreamHistory[0]).toEqual(['op-1', 50]);
    });
  });

  describe('cleanupOperation', () => {
    it('delegates directly to inner', async () => {
      await notifier.cleanupOperation('op-1');

      expect(inner.calls.cleanupOperation).toHaveLength(1);
    });
  });

  describe('getActiveOperationsCount', () => {
    it('delegates directly to inner', async () => {
      await notifier.getActiveOperationsCount();

      expect(inner.calls.getActiveOperationsCount).toHaveLength(1);
    });
  });

  describe('disconnect', () => {
    it('delegates directly to inner', async () => {
      await notifier.disconnect();

      expect(inner.calls.disconnect).toHaveLength(1);
    });
  });

  // ─── Gateway failure resilience ───

  describe('gateway failure does not affect inner', () => {
    it('publishStreamEvent succeeds when gateway is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('connection refused'));

      const result = await notifier.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'step_start' as const,
      });

      expect(result).toBe('publishStreamEvent-result');
      expect(inner.calls.publishStreamEvent).toHaveLength(1);
    });

    it('publishAgentRuntimeInit succeeds when gateway returns 500', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => 'Internal Error' });

      const result = await notifier.publishAgentRuntimeInit('op-1', { userId: 'u1' });

      expect(result).toBe('publishAgentRuntimeInit-result');
      expect(inner.calls.publishAgentRuntimeInit).toHaveLength(1);
    });

    it('publishAgentRuntimeEnd succeeds when gateway times out', async () => {
      mockFetch.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10)),
      );

      const result = await notifier.publishAgentRuntimeEnd('op-1', 0, {}, 'completed');

      expect(result).toBe('publishAgentRuntimeEnd-result');
      expect(inner.calls.publishAgentRuntimeEnd).toHaveLength(1);
    });
  });

  // ─── Timeout and concurrency ───

  describe('timeout and concurrency control', () => {
    it('passes AbortSignal to fetch', async () => {
      await notifier.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'step_start' as const,
      });

      await new Promise((r) => setTimeout(r, 50));

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].signal).toBeInstanceOf(AbortSignal);
    });

    it('drops requests when max inflight is reached', async () => {
      // Hold all fetches pending
      const resolvers: Array<() => void> = [];
      mockFetch.mockImplementation(
        () =>
          new Promise<{ ok: boolean }>((resolve) => {
            resolvers.push(() => resolve({ ok: true }));
          }),
      );

      // Fire 25 events (max inflight is 20)
      for (let i = 0; i < 25; i++) {
        notifier.publishStreamEvent(`op-${i}`, {
          data: {},
          stepIndex: 0,
          type: 'step_start' as const,
        });
      }

      await new Promise((r) => setTimeout(r, 50));

      // Only 20 should have actually called fetch
      expect(mockFetch).toHaveBeenCalledTimes(20);

      // Release all pending
      for (const r of resolvers) r();
    });

    it('uses url-join for URL construction', async () => {
      await notifier.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'step_start' as const,
      });

      await new Promise((r) => setTimeout(r, 50));

      const url = mockFetch.mock.calls[0][0];
      expect(url).toBe(`${gatewayUrl}/api/operations/push-event`);
      // No double slashes
      expect(url).not.toContain('//api');
    });
  });
});
