import type { PiRpcSession } from '@lobechat/heterogeneous-agents/rpc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PiRpcPool } from './piRpcPool';

vi.mock('@/utils/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));

const createSession = (running = false) => {
  const close = vi.fn().mockResolvedValue(undefined);
  const session = {
    close,
    isReusable: !running,
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

  it('evicts an idle process that died rather than returning it', () => {
    const pool = new PiRpcPool({ idleTimeoutMs: 100 });
    const { session, close } = createSession();
    pool.register('dead', session);
    Object.defineProperty(session, 'isReusable', { value: false });
    expect(pool.acquire('dead')).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it('awaits in-progress closes and prevents late registration during shutdown', async () => {
    const pool = new PiRpcPool({ idleTimeoutMs: 100 });
    const { session, close } = createSession();
    let finish!: () => void;
    close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    pool.register('first', session);
    pool.remove(session);
    const finished = vi.fn();
    const shutdown = pool.closeAll();
    void Promise.resolve(shutdown).then(finished);
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    const late = createSession();
    pool.register('late', late.session);
    expect(late.close).toHaveBeenCalledOnce();
    expect(pool.acquire('late')).toBeUndefined();
    finish();
    await shutdown;
    expect(finished).toHaveBeenCalledOnce();
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

  it('never reuses a process spawned under different runtime options', () => {
    const pool = new PiRpcPool({ idleTimeoutMs: 60_000 });
    const { session: a1 } = createSession();
    pool.register('cwd::sess-a', a1, 'fingerprint-v1');

    // Same key + same fingerprint → reuse.
    expect(pool.acquire('cwd::sess-a', 'fingerprint-v1')).toBe(a1);
    // Same key, different runtime options → spawn fresh (undefined).
    expect(pool.acquire('cwd::sess-a', 'fingerprint-v2')).toBeUndefined();
  });

  it('rejects acquisition of a busy process rather than allowing a second writer', () => {
    const pool = new PiRpcPool({ idleTimeoutMs: 60_000 });
    const { session, close } = createSession();
    pool.register('cwd::sess-a', session);

    // Registered while idle, then acquired for an active follow-up turn.
    pool.acquire('cwd::sess-a');
    Object.defineProperty(session, 'isRunning', { value: true });
    expect(() => pool.acquire('cwd::sess-a')).toThrow('active run');
    expect(close).not.toHaveBeenCalled();
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

  it('remove() closes a fresh session that never reached the pool', () => {
    const pool = new PiRpcPool({ idleTimeoutMs: 60_000 });
    const { close: closeA, session: a1 } = createSession();

    // Failed before register() — remove must still tear the process down.
    pool.remove(a1);
    expect(closeA).toHaveBeenCalledTimes(1);
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

  it('closeAll shuts down every pooled process', async () => {
    const pool = new PiRpcPool({ idleTimeoutMs: 60_000 });
    const { close: closeA, session: a1 } = createSession();
    const { close: closeB, session: b1 } = createSession();

    pool.register('cwd::sess-a', a1);
    pool.register('cwd::sess-b', b1);
    await pool.closeAll();

    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(pool.acquire('cwd::sess-a')).toBeUndefined();
  });
});
