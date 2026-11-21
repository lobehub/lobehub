import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren, useLayoutEffect } from 'react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { commentAnchorId } from '../Comments/anchor';
import type { EvidenceOverlay } from './overlay';
import { useImageThreads } from './useImageThreads';

const annotations: EvidenceOverlay[] = ['first', 'second'].map((threadId) => ({
  threadId,
  commentIds: [threadId, `${threadId}-reply`],
  rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
}));
const router = (id = '') =>
  function Wrapper({ children }: PropsWithChildren) {
    return createElement(MemoryRouter, {
      children,
      initialEntries: [`/acceptance/test/check/c1#${id ? commentAnchorId(id) : ''}`],
    });
  };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('image comment links', () => {
  it.each(['second', 'second-reply'])(
    'opens and scrolls to %s after comments arrive asynchronously',
    (id) => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect() {}
        },
      );
      const target = document.createElement('div');
      target.id = commentAnchorId(id);
      target.scrollIntoView = vi.fn();
      const { result, rerender } = renderHook(
        ({ items }) => {
          const state = useImageThreads(items);
          useLayoutEffect(() => {
            if (state.openedNote === 1) document.body.append(target);
            return () => target.remove();
          }, [state.openedNote]);
          return state;
        },
        { initialProps: { items: [] as EvidenceOverlay[] }, wrapper: router(id) },
      );
      expect(target.scrollIntoView).not.toHaveBeenCalled();
      rerender({ items: annotations });
      expect(result.current.openedNote).toBe(1);
      expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
      act(() => result.current.close());
      rerender({ items: [...annotations] });
      expect(result.current.openedNote).toBeUndefined();
    },
  );

  it('follows another fragment during navigation and allows manual pin toggling', () => {
    const { result } = renderHook(
      () => ({ ...useImageThreads(annotations), navigate: useNavigate() }),
      { wrapper: router('first') },
    );
    expect(result.current.openedNote).toBe(0);
    act(() => result.current.navigate('#comment-second-reply'));
    expect(result.current.openedNote).toBe(1);
    act(() => result.current.toggleNote(0));
    expect(result.current.openedNote).toBe(0);
    act(() => result.current.toggleNote(0));
    expect(result.current.openedNote).toBeUndefined();
  });

  it('leaves unrelated images and embedded viewers closed', () => {
    const { result } = renderHook(() => useImageThreads(annotations), {
      wrapper: router('another-image'),
    });
    expect(result.current.openedNote).toBeUndefined();
    const embedded = renderHook(() => useImageThreads(annotations, true), {
      wrapper: router('first'),
    });
    expect(embedded.result.current.openedNote).toBeUndefined();
  });
});
