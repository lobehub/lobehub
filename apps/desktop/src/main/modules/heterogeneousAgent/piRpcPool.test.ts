import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PiRpcSession } from '@lobechat/heterogeneous-agents/rpc';

import { PiRpcPool } from './piRpcPool';

const createSession = (running = false) => {
  const close = vi.fn().mockResolvedValue(undefined);
  const session = {
    close,
    isRunning: running,
  } as unknown as PiRpcSession;
  return { close, session };
};

describe('PiRpcPool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('acquires the idle pooled process for the same key and never mixes keys', () => {
    const pool = new PiRpcPool({ idleTimeoutMs: 60_000 });
    const { session: a1 } = createSession();
    const { session: b1 } = createSession();

    pool.register('cwd::sess-a', a1);
    pool.register('cwd::sess-b', b1);

    // Topic A's second turn reuses A's process, topic B's reuses B's.
    expect(pool.acquire('cwd::sess-a')).toBe(a1);
    expect(pool.acquire('cwd::sess-b')).toBe(b1);
    // A never-visited key spawns fresh (undefined).
    expect(pool.acquire('cwd::sess-c')).toBeUndefined();
  });

  it('never reuses a busy process', () => {
    const pool = new PiRpcPool({ idleTimeoutMs: 60_000 });
    const { session } = createSession(true);
    pool.register('cwd::sess-a', session);

    expect(pool.acquire('cwd::sess-a')).toBeUndefined();
  });

  it('reaps exactly the idle key — other keys are untouched', () => {
    const reaped: string[] = [];
    const pool = new PiRpcPool({ idleTimeoutMs: 100, onReap: (key) => void reaped.push(key) });
    const { close: closeA, session: a1 } = createSession();
    const { session: b1 } = createSession();

    pool.register('cwd::sess-a', a1);
    pool.register('cwd::sess-b', b1);
    pool.release(a1);

    vi.advanceTimersByTime(150);
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(reaped).toEqual(['cwd::sess-a']);
    // B is still alive and reusable.
    expect(pool.acquire('cwd::sess-b')).toBe(b1);
    expect(pool.acquire('cwd::sess-a')).toBeUndefined();
  });

  it('remove() closes only the failed session, not its siblings', () => {
    const pool = new PiRpcPool({ idleTimeoutMs: 60_000 });
    const { close: closeA, session: a1 } = createSession();
    const { close: closeB, session: b1 } = createSession();

    pool.register('cwd::sess-a', a1);
    pool.register('cwd::sess-b', b1);
    pool.release(a1);
    pool.release(b1);

    pool.remove(a1);
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).not.toHaveBeenCalled();
    expect(pool.acquire('cwd::sess-b')).toBe(b1);
  });

  it('acquire clears the idle timer so an active reuse is not reaped', () => {
    const pool = new PiRpcPool({ idleTimeoutMs: 100 });
    const { session: a1 } = createSession();

    pool.register('cwd::sess-a', a1);
    pool.release(a1);
    // Reuse before the window elapses.
    const reused = pool.acquire('cwd::sess-a');
    vi.advanceTimersByTime(500);
    expect(reused).toBe(a1);
    // No close happened despite the original timer elapsing (it was cleared).
    expect(pool.acquire('cwd::sess-a')).toBe(a1);
  });

  it('closeAll shuts down every pooled process', () => {
    const pool = new PiRpcPool({ idleTimeoutMs: 60_000 });
    const { close: closeA, session: a1 } = createSession();
    const { close: closeB, session: b1 } = createSession();

    pool.register('cwd::sess-a', a1);
    pool.register('cwd::sess-b', b1);
    pool.closeAll();

    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(pool.acquire('cwd::sess-a')).toBeUndefined();
  });
});
