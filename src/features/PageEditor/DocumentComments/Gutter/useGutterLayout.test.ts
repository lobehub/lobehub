import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentCommentAnchorsProvider } from '../anchor/context';
import type { DocumentCommentAnchorsValue } from '../anchor/useDocumentCommentAnchors';
import { PENDING_CARD_ID, useGutterLayout } from './useGutterLayout';

/** Frames are held until `flush`, the way a background tab never gets one. */
const fakeFrames = () => {
  const queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = next++;
    queue.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id));
  return {
    flush: () => {
      const pending = [...queue.values()];
      queue.clear();
      for (const callback of pending) callback(performance.now());
    },
    get size() {
      return queue.size;
    },
  };
};

const rangeAt = (top: number) =>
  ({
    getBoundingClientRect: () => ({ top }) as DOMRect,
    getClientRects: () => [] as unknown as DOMRectList,
  }) as unknown as Range;

const anchors = (
  overrides: Partial<DocumentCommentAnchorsValue> = {},
): DocumentCommentAnchorsValue => ({
  activeRootId: null,
  bodyElement: null,
  getAnchorMatch: () => null,
  getAnchorRange: () => rangeAt(120),
  getPendingAnchorRange: () => null,
  locateInBody: () => {},
  orphanedRootIds: new Set(),
  pickTick: 0,
  resolvedAt: 1,
  selectedRootId: null,
  selectRoot: () => {},
  setHoveredRootId: () => {},
  ...overrides,
});

describe('useGutterLayout', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('still measures after the anchors change while a frame is held back', () => {
    const frames = fakeFrames();
    const pane = document.createElement('div');
    pane.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const track = document.createElement('div');
    const host = document.createElement('div');
    host.append(track);
    document.body.append(pane, host);
    const card = document.createElement('div');
    Object.defineProperty(card, 'offsetHeight', { value: 100 });

    let value = anchors();
    const { rerender, result } = renderHook(
      () =>
        useGutterLayout({
          activeId: null,
          hasPending: false,
          ids: ['a'],
          paneRef: { current: pane },
          trackRef: { current: track },
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(DocumentCommentAnchorsProvider, { children, value }),
      },
    );
    act(() => result.current.registerCard('a')(card));
    expect(frames.size).toBeGreaterThan(0);

    // The frame never fires (hidden tab); meanwhile the anchors are re-resolved
    // with fresh callbacks, which rebuilds the scheduler.
    value = anchors();
    rerender();
    act(() => frames.flush());

    expect(result.current.tops.get('a')).toBe(120);
  });

  it('docks an orphaned pending draft at the pane top instead of leaving it unmeasured', () => {
    const frames = fakeFrames();
    const pane = document.createElement('div');
    pane.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    Object.defineProperty(pane, 'scrollTop', { value: 40 });
    const track = document.createElement('div');
    const host = document.createElement('div');
    host.append(track);
    document.body.append(pane, host);
    const card = document.createElement('div');
    Object.defineProperty(card, 'offsetHeight', { value: 80 });

    // The draft's quote no longer resolves — e.g. the text was edited away.
    const value = anchors({ getPendingAnchorRange: () => null });
    const { result } = renderHook(
      () =>
        useGutterLayout({
          activeId: null,
          hasPending: true,
          ids: [],
          paneRef: { current: pane },
          trackRef: { current: track },
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(DocumentCommentAnchorsProvider, { children, value }),
      },
    );
    act(() => result.current.registerCard(PENDING_CARD_ID)(card));
    act(() => frames.flush());

    expect(result.current.tops.get(PENDING_CARD_ID)).toBe(40);
  });
});
