import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';

import { useFollowSent } from './useFollowSent';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(MemoryRouter, { initialEntries: ['/channels/chn_1'] }, children);

const render = (threadId: string | null, onOpenThread = vi.fn()) => {
  const hook = renderHook(
    () => ({ follow: useFollowSent(threadId, onOpenThread), navigate: useNavigate() }),
    { wrapper },
  );
  return { ...hook, onOpenThread };
};

describe('useFollowSent', () => {
  let scope: string;
  beforeEach(() => {
    scope = 'scope';
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens the thread a main-conversation reply landed in, including after a retry', async () => {
    const { result, onOpenThread } = render(null);

    await act(async () => result.current.follow(Promise.resolve({ threadId: 'thread' })));

    expect(onOpenThread).toHaveBeenCalledWith('thread', false);
  });

  it.each([
    ['stays in the main conversation', null, { threadId: null }],
    ['did not send', null, undefined],
    ['was sent inside a thread already', 'thread', { threadId: 'thread' }],
  ])('does nothing when the message %s', async (_, threadId, stored) => {
    const { result, onOpenThread } = render(threadId);

    await act(async () => result.current.follow(Promise.resolve(stored)));

    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it('does not pull the user back after they left the conversation', async () => {
    const { result, onOpenThread } = render(null);
    const gate = Promise.withResolvers<{ threadId: string }>();
    act(() => result.current.follow(gate.promise));

    act(() => result.current.navigate('/channels/chn_2'));
    await act(async () => gate.resolve({ threadId: 'thread' }));

    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it('does not open a thread under an identity that replaced the sender', async () => {
    const { result, onOpenThread } = render(null);
    const gate = Promise.withResolvers<{ threadId: string }>();
    act(() => result.current.follow(gate.promise));

    scope = 'other';
    await act(async () => gate.resolve({ threadId: 'thread' }));

    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it('does nothing once the conversation unmounted', async () => {
    const { result, onOpenThread, unmount } = render(null);
    const gate = Promise.withResolvers<{ threadId: string }>();
    act(() => result.current.follow(gate.promise));

    unmount();
    await act(async () => gate.resolve({ threadId: 'thread' }));

    expect(onOpenThread).not.toHaveBeenCalled();
  });
});
