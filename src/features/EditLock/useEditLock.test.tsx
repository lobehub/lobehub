import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type EditLockClient, type EditLockState, useEditLock } from './useEditLock';

const free: EditLockState = { holderId: null, lockedByOther: false };

const heldByMe = (expiresInMs = 30_000): EditLockState => ({
  expiresAt: new Date(Date.now() + expiresInMs),
  holderId: 'me',
  lockedByOther: false,
  ownerId: 'owner-mine',
});

const heldByOther: EditLockState = {
  expiresAt: new Date(Date.now() + 30_000),
  holderId: 'other',
  lockedByOther: true,
  ownerId: 'owner-theirs',
};

const flushMicrotasks = () => act(() => Promise.resolve());

describe('useEditLock — health state machine', () => {
  let client: EditLockClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = {
      acquire: vi.fn(() => Promise.resolve(heldByMe())),
      peek: vi.fn(() => Promise.resolve(free)),
      release: vi.fn(() => Promise.resolve()),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('viewers report healthy and never enter the editor loop', async () => {
    const { result } = renderHook(() =>
      useEditLock({ client, enabled: true, isDirty: false, resourceId: 'doc-1' }),
    );

    await flushMicrotasks();

    expect(result.current.health).toBe('healthy');
    expect(client.acquire).not.toHaveBeenCalled();
    expect(client.peek).toHaveBeenCalledWith('doc-1', undefined);
  });

  it('editor transitions to healthy after a successful acquire', async () => {
    const { result, rerender } = renderHook(
      ({ isDirty }: { isDirty: boolean }) =>
        useEditLock({ client, enabled: true, isDirty, resourceId: 'doc-1' }),
      { initialProps: { isDirty: false } },
    );

    rerender({ isDirty: true });
    await flushMicrotasks();

    expect(result.current.health).toBe('healthy');
    expect(result.current.holderId).toBe('me');
    expect(client.acquire).toHaveBeenCalledTimes(1);
  });

  it('lockedByOther on acquire flips health to lost and keeps ticking', async () => {
    (client.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(heldByOther);

    const { result } = renderHook(() =>
      useEditLock({ client, enabled: true, isDirty: true, resourceId: 'doc-1' }),
    );

    await flushMicrotasks();
    expect(result.current.health).toBe('lost');
    expect(result.current.lockedByOther).toBe(true);

    // Loop keeps ticking on the regular heartbeat cadence so we auto-reclaim
    // once the holder releases.
    (client.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(heldByMe());
    await act(async () => {
      vi.advanceTimersByTime(11_000);
      await Promise.resolve();
    });
    await flushMicrotasks();
    expect(result.current.health).toBe('healthy');
    expect(result.current.lockedByOther).toBe(false);
  });

  it('single acquire failure marks unstable and retries quickly', async () => {
    (client.acquire as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(heldByMe());

    const { result } = renderHook(() =>
      useEditLock({ client, enabled: true, isDirty: true, resourceId: 'doc-1' }),
    );

    await flushMicrotasks();
    expect(result.current.health).toBe('unstable');

    // Retry fires on the short backoff (500ms) and clears unstable.
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
    await flushMicrotasks();
    expect(result.current.health).toBe('healthy');
    expect(client.acquire).toHaveBeenCalledTimes(2);
  });

  it('two failures in a row escalates to lost', async () => {
    (client.acquire as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() =>
      useEditLock({ client, enabled: true, isDirty: true, resourceId: 'doc-1' }),
    );

    await flushMicrotasks();
    expect(result.current.health).toBe('unstable');

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
    await flushMicrotasks();
    expect(result.current.health).toBe('lost');
  });

  it('online event kicks an immediate heartbeat', async () => {
    (client.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(heldByMe(20_000));

    renderHook(() => useEditLock({ client, enabled: true, isDirty: true, resourceId: 'doc-1' }));
    await flushMicrotasks();
    expect(client.acquire).toHaveBeenCalledTimes(1);

    // Without `online` we'd wait ~12s (20s lease - 8s safety). Firing the event
    // should re-acquire right away.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    await flushMicrotasks();
    expect(client.acquire).toHaveBeenCalledTimes(2);
  });

  it('release is called on unmount', async () => {
    const { unmount } = renderHook(() =>
      useEditLock({ client, enabled: true, isDirty: true, resourceId: 'doc-1' }),
    );
    await flushMicrotasks();

    unmount();
    expect(client.release).toHaveBeenCalledWith('doc-1', undefined);
  });

  it('viewers fall back to a slow safety-net poll even when pollWhileViewing is false', async () => {
    renderHook(() =>
      useEditLock({
        client,
        enabled: true,
        isDirty: false,
        pollWhileViewing: false,
        resourceId: 'doc-1',
      }),
    );
    await flushMicrotasks();
    expect(client.peek).toHaveBeenCalledTimes(1);

    // Fast poll (10s) should NOT fire — the caller explicitly opted out.
    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    await flushMicrotasks();
    expect(client.peek).toHaveBeenCalledTimes(1);

    // 60s safety-net peek fires so a viewer stranded by missed SSE recovers.
    await act(async () => {
      vi.advanceTimersByTime(50_000);
      await Promise.resolve();
    });
    await flushMicrotasks();
    expect(client.peek).toHaveBeenCalledTimes(2);
  });

  it('releases on pagehide so a refresh does not strand the lease', async () => {
    const { unmount } = renderHook(() =>
      useEditLock({ client, enabled: true, isDirty: true, resourceId: 'doc-1' }),
    );
    await flushMicrotasks();
    expect(client.release).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
      await Promise.resolve();
    });
    expect(client.release).toHaveBeenCalledTimes(1);

    // Unmount cleanup should not double-release after pagehide already fired.
    unmount();
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
