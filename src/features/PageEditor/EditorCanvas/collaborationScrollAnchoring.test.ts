/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPageScrollAnchoring,
  PAGE_EDITOR_SCROLL_CONTAINER_ATTRIBUTE,
  type PageCaretRect,
} from './collaborationScrollAnchoring';

const setScrollMetrics = (element: HTMLElement, height = 400, width = 600) => {
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height });
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: height * 4 });
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: width * 2 });
  Object.defineProperty(element, 'scrollTop', { configurable: true, value: 100, writable: true });
  Object.defineProperty(element, 'scrollLeft', { configurable: true, value: 0, writable: true });
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, width, height));
};

const createElementScroller = () => {
  const scroller = document.createElement('div');
  const root = document.createElement('div');
  scroller.dataset.pageEditorScrollContainer = '';
  scroller.style.overflow = 'auto';
  scroller.append(root);
  document.body.append(scroller);
  setScrollMetrics(scroller);
  return { root, scroller };
};

const createFrameQueue = () => {
  const callbacks = new Map<number, (time: number) => void>();
  let nextHandle = 0;
  return {
    cancel: (handle: number) => callbacks.delete(handle),
    flush: () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(0));
    },
    request: (callback: (time: number) => void) => {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    },
  };
};

const caret = (top: number, left = 100): PageCaretRect => ({
  bottom: top + 20,
  left,
  right: left + 1,
  top,
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Page collaboration scroll anchoring', () => {
  it('keeps the caret within one pixel when remote content is inserted or deleted above', () => {
    const { root, scroller } = createElementScroller();
    const frames = createFrameQueue();
    let caretTop = 220;
    const controller = createPageScrollAnchoring({
      cancelAnimationFrame: frames.cancel,
      getCaretRect: () => caret(caretTop - scroller.scrollTop),
      now: () => 1_000,
      requestAnimationFrame: frames.request,
      root,
    });

    caretTop += 140;
    controller.handleRemoteUpdate();
    frames.flush();
    expect(scroller.scrollTop).toBe(240);
    expect(caretTop - scroller.scrollTop).toBeCloseTo(120, 0);

    caretTop -= 90;
    controller.handleRemoteUpdate();
    frames.flush();
    expect(scroller.scrollTop).toBe(150);
    expect(caretTop - scroller.scrollTop).toBeCloseTo(120, 0);
    controller.dispose();
  });

  it('does not scroll for updates below the local caret', () => {
    const { root, scroller } = createElementScroller();
    const frames = createFrameQueue();
    const caretTop = 220;
    const controller = createPageScrollAnchoring({
      cancelAnimationFrame: frames.cancel,
      getCaretRect: () => caret(caretTop - scroller.scrollTop),
      requestAnimationFrame: frames.request,
      root,
    });

    controller.handleRemoteUpdate();
    frames.flush();
    expect(scroller.scrollTop).toBe(100);
    controller.dispose();
  });

  it('backs off during an active user wheel/touch scroll grace window', () => {
    const { root, scroller } = createElementScroller();
    const frames = createFrameQueue();
    let now = 1_000;
    let caretTop = 220;
    const controller = createPageScrollAnchoring({
      cancelAnimationFrame: frames.cancel,
      getCaretRect: () => caret(caretTop - scroller.scrollTop),
      now: () => now,
      requestAnimationFrame: frames.request,
      root,
    });

    scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    caretTop += 120;
    controller.handleRemoteUpdate();
    frames.flush();
    expect(scroller.scrollTop).toBe(100);

    now += 301;
    caretTop += 50;
    controller.handleRemoteUpdate();
    frames.flush();
    expect(scroller.scrollTop).toBe(150);
    controller.dispose();
  });

  it('uses window scrolling when no Page element scroller exists', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const frames = createFrameQueue();
    let caretTop = 220;
    let windowScrollY = 0;
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation((_x = 0, y = 0) => {
      windowScrollY += y;
    });
    const controller = createPageScrollAnchoring({
      cancelAnimationFrame: frames.cancel,
      getCaretRect: () => caret(caretTop - windowScrollY),
      ownerWindow: window,
      requestAnimationFrame: frames.request,
      root,
    });

    caretTop += 80;
    controller.handleRemoteUpdate();
    frames.flush();
    expect(scrollBy).toHaveBeenCalledWith(0, 80);
    expect(caretTop - windowScrollY).toBe(220);
    controller.dispose();
  });

  it('coalesces a stream of remote chunks into stable frame compensation', () => {
    const { root, scroller } = createElementScroller();
    const frames = createFrameQueue();
    let caretTop = 220;
    const controller = createPageScrollAnchoring({
      cancelAnimationFrame: frames.cancel,
      getCaretRect: () => caret(caretTop - scroller.scrollTop),
      requestAnimationFrame: frames.request,
      root,
    });

    caretTop += 45;
    controller.handleRemoteUpdate();
    caretTop += 45;
    controller.handleRemoteUpdate();
    caretTop += 45;
    controller.handleRemoteUpdate();
    expect(scroller.scrollTop).toBe(100);
    frames.flush();
    expect(scroller.scrollTop).toBe(235);
    expect(caretTop - scroller.scrollTop).toBeCloseTo(120, 0);
    controller.dispose();
  });

  it('fails safe when the caret is not visible or the root loses its selection', () => {
    const { root, scroller } = createElementScroller();
    const frames = createFrameQueue();
    let current: PageCaretRect | null = null;
    const controller = createPageScrollAnchoring({
      cancelAnimationFrame: frames.cancel,
      getCaretRect: () => current,
      requestAnimationFrame: frames.request,
      root,
    });

    current = caret(900);
    controller.refresh();
    current = caret(950);
    controller.handleRemoteUpdate();
    frames.flush();
    expect(scroller.scrollTop).toBe(100);
    current = null;
    controller.handleRemoteUpdate();
    frames.flush();
    expect(scroller.scrollTop).toBe(100);
    controller.dispose();
  });

  it('recognizes the shared Page scroll-container attribute', () => {
    const { root } = createElementScroller();
    expect(root.closest(`[${PAGE_EDITOR_SCROLL_CONTAINER_ATTRIBUTE}]`)).not.toBeNull();
  });
});
