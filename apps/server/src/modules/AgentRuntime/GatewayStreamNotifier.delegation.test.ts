import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayStreamNotifier } from './GatewayStreamNotifier';
import { createMockInner } from './testUtils';

const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
vi.stubGlobal('fetch', mockFetch);

describe('GatewayStreamNotifier read and lifecycle delegation', () => {
  let inner: ReturnType<typeof createMockInner>;
  let notifier: GatewayStreamNotifier;

  beforeEach(() => {
    vi.clearAllMocks();
    inner = createMockInner();
    notifier = new GatewayStreamNotifier(inner, 'https://gateway.test.com', 'test-token');
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

  describe('getStreamHistoryPage', () => {
    it('delegates the exclusive history cursor to inner', async () => {
      const result = await notifier.getStreamHistoryPage('op-1', '123-4', 200);

      expect(inner.calls.getStreamHistoryPage).toEqual([['op-1', '123-4', 200]]);
      expect(result).toBe('getStreamHistoryPage-result');
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
});
