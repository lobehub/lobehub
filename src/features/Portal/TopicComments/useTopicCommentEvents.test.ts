// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicCommentEvents } from './useTopicCommentEvents';

const fetchEventSource = vi.hoisted(() => vi.fn());
vi.mock('@lobechat/utils/client', () => ({ fetchEventSource }));
vi.mock('@/services/_auth', () => ({ createHeaderWithAuth: vi.fn().mockResolvedValue({}) }));
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
    fetchEventSource.mockReset();
    attempts = [];
    fetchEventSource.mockImplementation(
      (_url: string, options: StreamAttempt['options']) =>
        new Promise<void>((resolve) => attempts.push({ options, resolve })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mount = async (refresh = vi.fn().mockResolvedValue(undefined)) => {
    const result = renderHook(() => useTopicCommentEvents('topic-1', true, refresh));
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

  it('reconnects after a normal close and polls until the next stream opens', async () => {
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
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('does not retry or poll fatal 4xx responses', async () => {
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
    const { options } = attempts[0];
    options.onerror({});
    options.onmessage({ data: JSON.stringify({ type: 'topic.commentsChanged' }) });
    unmount();
    expect(options.signal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(refresh).not.toHaveBeenCalled();
  });
});
