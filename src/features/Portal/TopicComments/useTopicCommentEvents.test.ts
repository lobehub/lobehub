// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicCommentEvents } from './useTopicCommentEvents';

const fetchEventSource = vi.hoisted(() => vi.fn());
const createHeaderWithAuth = vi.hoisted(() => vi.fn());
vi.mock('@lobechat/utils/client', () => ({ fetchEventSource }));
vi.mock('@/services/_auth', () => ({ createHeaderWithAuth }));
vi.mock('@/business/client/trpc-headers', () => ({
  getBusinessTrpcHeaders: vi.fn().mockResolvedValue({ 'X-Workspace-Id': 'workspace-1' }),
}));

interface StreamAttempt {
  options: {
    onerror: (error: { fatal?: boolean }) => void;
    onmessage: (event: { data: string }) => void;
    onopen: (response: Response) => Promise<void>;
    signal: AbortSignal;
  };
  resolve: () => void;
}

describe('useTopicCommentEvents', () => {
  let attempts: StreamAttempt[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fetchEventSource.mockReset();
    createHeaderWithAuth.mockReset().mockResolvedValue({});
    attempts = [];
    fetchEventSource.mockImplementation(
      (_url: string, options: StreamAttempt['options']) =>
        new Promise<void>((resolve) => attempts.push({ options, resolve })),
    );
  });

  afterEach(() => {
    vi.mocked(Math.random).mockRestore();
    vi.useRealTimers();
  });

  const mount = async (refresh = vi.fn().mockResolvedValue(undefined)) => {
    const result = renderHook(() => useTopicCommentEvents('topic-1', refresh));
    await act(async () => {});
    return { ...result, refresh };
  };

  it('refreshes on open and debounces matching events without filtering the actor', async () => {
    const { refresh } = await mount();
    const { options } = attempts[0];
    await act(() =>
      options.onopen(new Response('', { headers: { 'content-type': 'text/event-stream' } })),
    );
    expect(refresh).toHaveBeenCalledOnce();

    options.onmessage({ data: JSON.stringify({ actorId: 'self', type: 'topic.commentsChanged' }) });
    options.onmessage({ data: JSON.stringify({ type: 'topic.commentsChanged' }) });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('keeps a canonical reconciliation poll while the stream is open', async () => {
    const { refresh } = await mount();
    await act(() =>
      attempts[0].options.onopen(
        new Response('', { headers: { 'content-type': 'text/event-stream' } }),
      ),
    );

    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(attempts).toHaveLength(1);
  });

  it('backs off reconciliation polling after failures and resets after success', async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValue(undefined);
    await mount(refresh);
    await act(() =>
      attempts[0].options.onopen(
        new Response('', { headers: { 'content-type': 'text/event-stream' } }),
      ),
    );
    expect(refresh).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(refresh).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(refresh).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(29_999));
    expect(refresh).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('reconnects after a normal close without interrupting reconciliation polling', async () => {
    const { refresh } = await mount();
    const first = attempts[0];
    await act(() =>
      first.options.onopen(new Response('', { headers: { 'content-type': 'text/event-stream' } })),
    );
    expect(refresh).toHaveBeenCalledOnce();

    await act(async () => first.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(attempts).toHaveLength(2);

    await act(async () => vi.advanceTimersByTimeAsync(25_000));
    expect(refresh).toHaveBeenCalledTimes(2);

    const second = attempts[1];
    await act(() =>
      second.options.onopen(new Response('', { headers: { 'content-type': 'text/event-stream' } })),
    );
    expect(refresh).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('uses jittered exponential backoff across consecutive connection failures', async () => {
    vi.mocked(Math.random).mockReturnValue(0);
    await mount();
    const first = attempts[0];
    first.options.onerror({});
    await act(async () => first.resolve());

    await act(async () => vi.advanceTimersByTimeAsync(3999));
    expect(attempts).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(attempts).toHaveLength(2);

    const second = attempts[1];
    second.options.onerror({});
    await act(async () => second.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(7999));
    expect(attempts).toHaveLength(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(attempts).toHaveLength(3);
  });

  it('pauses polling and reconnects while hidden, then reconciles on visibility', async () => {
    const { refresh } = await mount();
    const first = attempts[0];
    await act(() =>
      first.options.onopen(new Response('', { headers: { 'content-type': 'text/event-stream' } })),
    );
    expect(refresh).toHaveBeenCalledOnce();

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => first.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(refresh).toHaveBeenCalledOnce();
    expect(attempts).toHaveLength(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {});
    expect(refresh).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(4999));
    expect(attempts).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(attempts).toHaveLength(2);
  });

  it('retries transient 4xx responses while retaining canonical polling', async () => {
    const { refresh } = await mount();
    const first = attempts[0];
    const error = await first.options
      .onopen(new Response('', { status: 429 }))
      .catch((cause) => cause);
    first.options.onerror(error);
    await act(async () => first.resolve());

    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(attempts).toHaveLength(2);
    await act(async () => vi.advanceTimersByTimeAsync(25_000));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does not retry or poll permanent 4xx responses', async () => {
    const { refresh } = await mount();
    const first = attempts[0];
    const error = await first.options
      .onopen(new Response('', { status: 403 }))
      .catch((cause) => cause);
    first.options.onerror(error);
    await act(async () => first.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(refresh).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(1);
  });

  it('aborts and clears pending work on unmount', async () => {
    const { refresh, unmount } = await mount();
    const { options, resolve } = attempts[0];
    options.onerror({});
    options.onmessage({ data: JSON.stringify({ type: 'topic.commentsChanged' }) });
    await act(async () => resolve());
    unmount();
    expect(options.signal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(refresh).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(1);
  });

  it('does not schedule work when header loading fails after unmount', async () => {
    let rejectHeaders: ((reason: Error) => void) | undefined;
    createHeaderWithAuth.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectHeaders = reject;
        }),
    );
    const { unmount } = await mount();
    unmount();

    await act(async () => rejectHeaders?.(new Error('header failure')));
    expect(fetchEventSource).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
