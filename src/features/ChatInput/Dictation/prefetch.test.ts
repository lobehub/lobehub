import { describe, expect, it, vi } from 'vitest';

import type { DictationConnection, RealtimeAsrWebSocket } from './connection';
import { REALTIME_ASR_DEFERRED_LIMITS } from './contract';
import { DictationPrefetcher } from './prefetch';

const createConnection = (): DictationConnection & { emit: (type: string) => void } => {
  const listeners = new Map<string, Set<() => void>>();
  const socket = {
    addEventListener: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    close: vi.fn(),
    readyState: 1,
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
  } as unknown as RealtimeAsrWebSocket;
  return {
    deferred: true,
    emit: (type) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    session: {} as DictationConnection['session'],
    socket,
  };
};

describe('DictationPrefetcher backoff', () => {
  it('backs off after a failed prefetch and retries once the delay passes', async () => {
    let now = 0;
    const connect = vi.fn().mockRejectedValue(new Error('gateway_down'));
    const prefetcher = new DictationPrefetcher({ connect, now: () => now, random: () => 1 });

    await prefetcher.prefetch();
    now = 29_000;
    await prefetcher.prefetch();
    expect(connect).toHaveBeenCalledOnce();

    now = 30_000;
    await prefetcher.prefetch();
    expect(connect).toHaveBeenCalledTimes(2);

    now = 89_000;
    await prefetcher.prefetch();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('caps the backoff at ten minutes', async () => {
    let now = 0;
    const connect = vi.fn().mockRejectedValue(new Error('gateway_down'));
    const prefetcher = new DictationPrefetcher({ connect, now: () => now, random: () => 1 });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await prefetcher.prefetch();
      now += 600_000;
    }
    expect(connect).toHaveBeenCalledTimes(8);
  });

  it('treats an early drop of a held session as a failure but not its idle expiry', async () => {
    let now = 0;
    const first = createConnection();
    const second = createConnection();
    const connect = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValue(createConnection());
    const prefetcher = new DictationPrefetcher({ connect, now: () => now, random: () => 1 });

    await prefetcher.prefetch();
    first.emit('close');
    await prefetcher.prefetch();
    expect(connect).toHaveBeenCalledOnce();

    now = 30_000;
    await prefetcher.prefetch();
    expect(connect).toHaveBeenCalledTimes(2);

    now += REALTIME_ASR_DEFERRED_LIMITS.acceptedIdleTimeoutMs;
    second.emit('message');
    await prefetcher.prefetch();
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('clears the backoff when a connection succeeds', async () => {
    let now = 0;
    const connect = vi.fn().mockRejectedValueOnce(new Error('gateway_down'));
    const prefetcher = new DictationPrefetcher({ connect, now: () => now, random: () => 1 });

    await prefetcher.prefetch();
    prefetcher.resetBackoff();
    connect.mockResolvedValueOnce(createConnection());
    now = 1000;
    await prefetcher.prefetch();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('does not count a prefetch aborted by discard as a failure', async () => {
    const connect = vi.fn(
      (signal: AbortSignal) =>
        new Promise<DictationConnection>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const prefetcher = new DictationPrefetcher({ connect, now: () => 0, random: () => 1 });

    const pending = prefetcher.prefetch();
    prefetcher.discard();
    await pending;
    void prefetcher.prefetch();
    expect(connect).toHaveBeenCalledTimes(2);
    prefetcher.discard();
  });

  it('gives up on a prefetch still in flight so a press can connect on its own', async () => {
    vi.useFakeTimers();
    const connect = vi.fn(() => new Promise<DictationConnection>(() => {}));
    const prefetcher = new DictationPrefetcher({ connect, now: () => 0, random: () => 1 });

    void prefetcher.prefetch();
    const taking = prefetcher.take();
    await vi.advanceTimersByTimeAsync(3000);

    await expect(taking).resolves.toBeUndefined();
    void prefetcher.prefetch();
    expect(connect).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
