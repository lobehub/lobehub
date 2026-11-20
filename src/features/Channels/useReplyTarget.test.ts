import type { ChannelPublicMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDraft, saveDraft } from '@/features/ChatInput/draftStorage';

import { useReplyTarget } from './useReplyTarget';

const { scope } = vi.hoisted(() => ({ scope: { value: 'owner:workspace' } }));
vi.mock('@/libs/replica', () => ({ cacheScope: { use: () => scope.value } }));
const message = (id: string) =>
  ({
    author: { avatar: null, id: 'agent', name: 'Author', type: 'agent' },
    content: 'An answer',
    id,
    sequence: 3,
    threadId: null,
  }) as ChannelPublicMessage;
const main = 'channel:example:main';

describe('Channel reply drafts', () => {
  beforeEach(() => {
    localStorage.clear();
    scope.value = 'owner:workspace';
  });

  it('restores a reply after remount and keeps thread and account drafts separate', () => {
    const first = renderHook(() => useReplyTarget(main));
    act(() => first.result.current.select(message('answer')));
    first.unmount();
    expect(renderHook(() => useReplyTarget(main)).result.current.target?.id).toBe('answer');
    expect(
      renderHook(() => useReplyTarget('channel:example:thread')).result.current.target,
    ).toBeNull();
    scope.value = 'another-user:workspace';
    expect(renderHook(() => useReplyTarget(main)).result.current.target).toBeNull();
  });

  it('cancel and reselect change only the quote, preserving the typed draft', () => {
    saveDraft(main, { text: 'Unsent thought' });
    const { result } = renderHook(() => useReplyTarget(main));
    act(() => result.current.select(message('first')));
    act(() => result.current.clear());
    expect(result.current.target).toBeNull();
    expect(getDraft(main)).toEqual({ text: 'Unsent thought' });
    act(() => result.current.select(message('second')));
    expect(result.current.target?.id).toBe('second');
    expect(getDraft(main)).toEqual({ text: 'Unsent thought' });
  });

  it('clears only the sent selection, preserving a newer local selection', () => {
    const { result, unmount } = renderHook(() => useReplyTarget(main));
    act(() => result.current.select(message('sent')));
    const sent = result.current.snapshot();
    act(() => result.current.select(message('new')));
    act(() => result.current.clear(sent));
    expect(result.current.target?.id).toBe('new');
    unmount();
    expect(renderHook(() => useReplyTarget(main)).result.current.target?.id).toBe('new');
  });

  it('preserves a newer quote saved by another window during an in-flight send', () => {
    const a = renderHook(() => useReplyTarget(main));
    const b = renderHook(() => useReplyTarget(main));
    act(() => a.result.current.select(message('sent')));
    const sent = a.result.current.snapshot();
    act(() => b.result.current.select(message('new')));
    act(() => a.result.current.clear(sent));
    a.unmount();
    b.unmount();
    expect(renderHook(() => useReplyTarget(main)).result.current.target?.id).toBe('new');
  });

  it('drops a sent quote and ignores invalid persisted data', () => {
    const { result, unmount } = renderHook(() => useReplyTarget(main));
    act(() => result.current.select(message('sent')));
    act(() => result.current.clear(result.current.snapshot()));
    unmount();
    expect(renderHook(() => useReplyTarget(main)).result.current.target).toBeNull();
    saveDraft(`${scope.value}:${main}:reply`, { id: 'incomplete' });
    expect(renderHook(() => useReplyTarget(main)).result.current.target).toBeNull();
  });
});
