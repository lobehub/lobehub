import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { watchToolCallCompletion } from './completionWatch';

afterEach(() => {
  vi.useRealTimers();
});

describe('completion retry timers', () => {
  it('clears a pending backoff when reconnect wakes and completes delivery', async () => {
    vi.useFakeTimers();
    const reporter = Object.assign(new EventEmitter(), {
      reportToolCallCompletion: vi
        .fn()
        .mockResolvedValueOnce({ status: 'retry' })
        .mockResolvedValueOnce({ status: 'delivered' }),
    });
    const result = watchToolCallCompletion({
      getReporter: () => reporter,
      observe: async () => ({ done: true, result: { content: 'done', success: true } }),
      operationId: 'operation',
      toolCallId: 'call',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    reporter.emit('connected');
    expect(await result).toBe('delivered');
    expect(reporter.listenerCount('connected')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
