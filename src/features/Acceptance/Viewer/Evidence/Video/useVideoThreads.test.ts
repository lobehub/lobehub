import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren, useLayoutEffect } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { commentAnchorId } from '../../Comments/anchor';
import type { EvidenceOverlay } from '../overlay';
import { useVideoThreads, videoThreadsOf } from './useVideoThreads';

const overlay = (threadId: string, start?: number, replies: string[] = []): EvidenceOverlay => ({
  commentIds: [threadId, ...replies],
  rect: { height: 0.2, width: 0.2, x: 0.1, y: 0.1 },
  threadId,
  time: start === undefined ? undefined : { start },
});

const overlays = [overlay('late', 6), overlay('image'), overlay('early', 2, ['early-reply'])];

const router = (commentId?: string) =>
  function Wrapper({ children }: PropsWithChildren) {
    return createElement(MemoryRouter, {
      children,
      initialEntries: [
        `/acceptance/test/checks/check#${commentId ? commentAnchorId(commentId) : ''}`,
      ],
    });
  };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('video threads', () => {
  it('lists only timed threads, in playing order', () => {
    expect(videoThreadsOf(overlays).map((item) => item.threadId)).toEqual(['early', 'late']);
  });

  it('keeps one thread unfolded and folds it on a second press', () => {
    const { result } = renderHook(() => useVideoThreads(overlays, vi.fn()), { wrapper: router() });
    expect(result.current.openId).toBeUndefined();

    act(() => {
      expect(result.current.toggle('early')).toBe(true);
    });
    expect(result.current.openId).toBe('early');
    act(() => result.current.open('late'));
    expect(result.current.openId).toBe('late');
    act(() => {
      expect(result.current.toggle('late')).toBe(false);
    });
    expect(result.current.openId).toBeUndefined();
  });

  it('opens the thread a reply link addresses and shows its frame once', () => {
    const onAnchor = vi.fn();
    const { result, rerender } = renderHook(() => useVideoThreads(overlays, onAnchor), {
      wrapper: router('early-reply'),
    });
    expect(result.current.openId).toBe('early');
    expect(onAnchor).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'early' }));

    act(() => result.current.toggle('early'));
    rerender();
    expect(result.current.openId).toBeUndefined();
    expect(onAnchor).toHaveBeenCalledTimes(1);
  });

  it.each(['early', 'early-reply'])(
    'scrolls to %s after asynchronously loaded comments unfold',
    (commentId) => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect() {}
        },
      );
      const target = document.createElement('div');
      target.id = commentAnchorId(commentId);
      target.scrollIntoView = vi.fn();
      const onAnchor = vi.fn();
      const { result, rerender } = renderHook(
        ({ items }) => {
          const state = useVideoThreads(items, onAnchor);
          // The thread's DOM is committed only when the addressed row opens.
          useLayoutEffect(() => {
            if (state.openId === 'early') document.body.append(target);
            return () => target.remove();
          }, [state.openId]);
          return state;
        },
        { initialProps: { items: [] as EvidenceOverlay[] }, wrapper: router(commentId) },
      );
      expect(target.scrollIntoView).not.toHaveBeenCalled();
      rerender({ items: overlays });
      expect(result.current.openId).toBe('early');
      expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
      expect(onAnchor).toHaveBeenCalledTimes(1);
    },
  );

  it('does not claim the page fragment in an embedded viewer', () => {
    const onAnchor = vi.fn();
    const { result } = renderHook(() => useVideoThreads(overlays, onAnchor, true), {
      wrapper: router('early-reply'),
    });
    expect(result.current.openId).toBeUndefined();
    expect(onAnchor).not.toHaveBeenCalled();
  });
});
