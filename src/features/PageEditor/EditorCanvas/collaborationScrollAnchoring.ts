export const PAGE_EDITOR_SCROLL_CONTAINER_ATTRIBUTE = 'data-page-editor-scroll-container';
export const PAGE_EDITOR_SCROLL_ANCHORING_ATTRIBUTE = 'data-page-editor-scroll-anchoring';
export const PAGE_EDITOR_SCROLL_ANCHOR_GRACE_MS = 300;

const SCROLL_DELTA_EPSILON = 0.5;
const PROGRAMMATIC_SCROLL_GUARD_MS = 120;

export interface PageCaretRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

type PageViewportRect = PageCaretRect;

export interface PageScrollAnchoringOptions {
  cancelAnimationFrame?: (handle: number) => void;
  enabled?: boolean;
  getCaretRect: () => PageCaretRect | null;
  now?: () => number;
  ownerWindow?: Window;
  requestAnimationFrame?: (callback: (time: number) => void) => number;
  root: HTMLElement;
  scrollGraceMs?: number;
}

export interface PageScrollAnchoringController {
  dispose: () => void;
  handleRemoteUpdate: () => void;
  refresh: () => void;
}

type PageScrollTarget =
  { element: HTMLElement; kind: 'element' } | { kind: 'window'; window: Window };

const isFiniteRect = (rect: PageCaretRect): boolean =>
  [rect.top, rect.bottom, rect.left, rect.right].every(Number.isFinite);

export const isPageCaretVisible = (caret: PageCaretRect, viewport: PageViewportRect): boolean =>
  caret.bottom >= viewport.top &&
  caret.top <= viewport.bottom &&
  caret.right >= viewport.left &&
  caret.left <= viewport.right;

const getElementViewport = (element: HTMLElement): PageViewportRect => {
  const rect = element.getBoundingClientRect();
  const top = rect.top + (element.clientTop || 0);
  const left = rect.left + (element.clientLeft || 0);
  const width = element.clientWidth || rect.width;
  const height = element.clientHeight || rect.height;

  return {
    bottom: top + height,
    left,
    right: left + width,
    top,
  };
};

const getWindowViewport = (ownerWindow: Window): PageViewportRect => ({
  bottom: ownerWindow.innerHeight || ownerWindow.document.documentElement.clientHeight,
  left: 0,
  right: ownerWindow.innerWidth || ownerWindow.document.documentElement.clientWidth,
  top: 0,
});

export const findPageScrollContainer = (
  root: HTMLElement,
  ownerWindow: Window | undefined = root.ownerDocument.defaultView ??
    (typeof window === 'undefined' ? undefined : window),
): HTMLElement | null => {
  if (!ownerWindow) return null;
  const pageContainer = root.closest<HTMLElement>(`[${PAGE_EDITOR_SCROLL_CONTAINER_ATTRIBUTE}]`);
  if (pageContainer) return pageContainer;

  let current: HTMLElement | null = root;
  while (current) {
    const style = ownerWindow.getComputedStyle(current);
    const overflow = [
      style.overflow,
      style.overflowX,
      style.overflowY,
      current.style.overflow,
      current.style.overflowX,
      current.style.overflowY,
    ].join(' ');
    if (/auto|scroll|overlay/.test(overflow)) return current;
    current = current.parentElement;
  }

  return null;
};

const getScrollTarget = (root: HTMLElement, ownerWindow: Window): PageScrollTarget => {
  const element = findPageScrollContainer(root, ownerWindow);
  return element ? { element, kind: 'element' } : { kind: 'window', window: ownerWindow };
};

const getScrollViewport = (target: PageScrollTarget, ownerWindow: Window): PageViewportRect =>
  target.kind === 'element' ? getElementViewport(target.element) : getWindowViewport(ownerWindow);

/** Capture the local native caret without asking the Editor kernel to change state. */
export const capturePageCaretRect = (root: HTMLElement): PageCaretRect | null => {
  const ownerDocument = root.ownerDocument;
  const selection = ownerDocument.defaultView?.getSelection() ?? ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.focusNode) return null;
  if (!root.contains(selection.focusNode)) return null;

  const range = ownerDocument.createRange();
  try {
    range.setStart(selection.focusNode, selection.focusOffset);
    range.collapse(true);
  } catch {
    return null;
  }

  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (!rect) return null;
  const caret: PageCaretRect = {
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    top: rect.top,
  };
  return isFiniteRect(caret) ? caret : null;
};

const noOpController: PageScrollAnchoringController = {
  dispose: () => undefined,
  handleRemoteUpdate: () => undefined,
  refresh: () => undefined,
};

/**
 * Keep a local caret at the same viewport coordinate while a remote Lexical
 * update changes content above it. The controller deliberately knows only
 * about DOM selection/scrolling; collaboration tagging stays in the React
 * plugin so the Editor kernel remains untouched.
 */
export const createPageScrollAnchoring = (
  options: PageScrollAnchoringOptions,
): PageScrollAnchoringController => {
  const {
    cancelAnimationFrame: cancelFrameOption,
    enabled = true,
    getCaretRect,
    now = Date.now,
    ownerWindow = options.root.ownerDocument.defaultView ??
      (typeof window === 'undefined' ? undefined : window),
    requestAnimationFrame: requestFrameOption,
    root,
    scrollGraceMs = PAGE_EDITOR_SCROLL_ANCHOR_GRACE_MS,
  } = options;
  if (!enabled || !ownerWindow) return noOpController;

  const requestFrame =
    requestFrameOption ??
    ((callback: (time: number) => void) => {
      if (typeof ownerWindow.requestAnimationFrame === 'function') {
        return ownerWindow.requestAnimationFrame(callback);
      }
      return ownerWindow.setTimeout(() => callback(now()), 0);
    });
  const cancelFrame =
    cancelFrameOption ??
    ((handle: number) => {
      if (typeof ownerWindow.cancelAnimationFrame === 'function') {
        ownerWindow.cancelAnimationFrame(handle);
      } else {
        ownerWindow.clearTimeout(handle);
      }
    });
  const ownerDocument = root.ownerDocument;
  const scrollElement = findPageScrollContainer(root, ownerWindow);
  let disposed = false;
  let frameHandle: number | undefined;
  let guardTimer: ReturnType<Window['setTimeout']> | undefined;
  let lastCaretRect: PageCaretRect | null = null;
  let pendingBeforeRect: PageCaretRect | null = null;
  let userScrollUntil = 0;
  let programmaticScrollUntil = 0;
  let applyingScroll = false;

  const clearPendingFrame = () => {
    pendingBeforeRect = null;
    if (frameHandle === undefined) return;
    cancelFrame(frameHandle);
    frameHandle = undefined;
  };

  const refresh = () => {
    if (disposed) return;
    clearPendingFrame();
    lastCaretRect = getCaretRect();
  };

  const markUserScroll = () => {
    if (disposed || applyingScroll) return;
    userScrollUntil = now() + Math.max(0, scrollGraceMs);
    clearPendingFrame();
    refresh();
  };

  const onScroll = () => {
    if (disposed || applyingScroll) return;
    if (now() < programmaticScrollUntil) return;
    if (scrollElement?.hasAttribute(PAGE_EDITOR_SCROLL_ANCHORING_ATTRIBUTE)) {
      // The Page editor's restore handler reads this same guard. Refresh the
      // cached scroll-relative caret only after its programmatic write lands.
      return;
    }
    markUserScroll();
  };

  const onSelectionChange = () => {
    if (pendingBeforeRect) clearPendingFrame();
    refresh();
  };

  const onResize = () => {
    clearPendingFrame();
    refresh();
  };

  const clearProgrammaticGuard = () => {
    guardTimer = undefined;
    scrollElement?.removeAttribute(PAGE_EDITOR_SCROLL_ANCHORING_ATTRIBUTE);
  };

  const setProgrammaticGuard = () => {
    if (!scrollElement) return;
    programmaticScrollUntil = Math.max(
      programmaticScrollUntil,
      now() + PROGRAMMATIC_SCROLL_GUARD_MS,
    );
    scrollElement.setAttribute(PAGE_EDITOR_SCROLL_ANCHORING_ATTRIBUTE, 'true');
    if (guardTimer !== undefined) ownerWindow.clearTimeout(guardTimer);
    guardTimer = ownerWindow.setTimeout(clearProgrammaticGuard, PROGRAMMATIC_SCROLL_GUARD_MS);
  };

  const applyScrollDelta = (deltaTop: number, deltaLeft: number) => {
    const target = getScrollTarget(root, ownerWindow);
    applyingScroll = true;
    try {
      if (target.kind === 'element') {
        setProgrammaticGuard();
        if (Math.abs(deltaTop) > SCROLL_DELTA_EPSILON) {
          target.element.scrollTop += deltaTop;
        }
        if (Math.abs(deltaLeft) > SCROLL_DELTA_EPSILON) {
          target.element.scrollLeft += deltaLeft;
        }
      } else if (typeof target.window.scrollBy === 'function') {
        target.window.scrollBy(deltaLeft, deltaTop);
      }
    } finally {
      applyingScroll = false;
    }
  };

  const runFrame = () => {
    frameHandle = undefined;
    const before = pendingBeforeRect;
    pendingBeforeRect = null;
    if (disposed || !before) return;

    const after = getCaretRect();
    if (!after) {
      lastCaretRect = null;
      return;
    }
    const target = getScrollTarget(root, ownerWindow);
    const viewport = getScrollViewport(target, ownerWindow);
    if (!isPageCaretVisible(before, viewport) || now() < userScrollUntil) {
      lastCaretRect = after;
      return;
    }

    const deltaTop = after.top - before.top;
    const deltaLeft = after.left - before.left;
    if (!Number.isFinite(deltaTop) || !Number.isFinite(deltaLeft)) {
      lastCaretRect = after;
      return;
    }
    if (Math.abs(deltaTop) <= SCROLL_DELTA_EPSILON && Math.abs(deltaLeft) <= SCROLL_DELTA_EPSILON) {
      lastCaretRect = after;
      return;
    }

    applyScrollDelta(deltaTop, deltaLeft);
    // A scroll assignment is synchronous for element scrollers, but keeping a
    // measured fallback makes clamped edges and window scrolling fail-safe.
    lastCaretRect = getCaretRect() ?? {
      bottom: after.bottom - deltaTop,
      left: after.left - deltaLeft,
      right: after.right - deltaLeft,
      top: after.top - deltaTop,
    };
  };

  const handleRemoteUpdate = () => {
    if (disposed) return;
    if (now() < userScrollUntil) {
      // A remote update during the grace window belongs to the user's new
      // scroll baseline. Do not compensate it later as if it happened after
      // the user stopped scrolling.
      clearPendingFrame();
      refresh();
      return;
    }
    const before = lastCaretRect ?? getCaretRect();
    if (!before) return;

    const target = getScrollTarget(root, ownerWindow);
    if (!isPageCaretVisible(before, getScrollViewport(target, ownerWindow))) return;
    pendingBeforeRect ??= before;
    if (frameHandle === undefined) frameHandle = requestFrame(runFrame);
  };

  const userInputEvents = ['pointerdown', 'touchstart', 'touchmove', 'wheel'] as const;
  const eventOptions: AddEventListenerOptions = { capture: true, passive: true };
  ownerWindow.addEventListener('scroll', onScroll, { passive: true });
  ownerWindow.addEventListener('resize', onResize);
  ownerDocument.addEventListener('selectionchange', onSelectionChange);
  scrollElement?.addEventListener('scroll', onScroll, { passive: true });
  for (const eventName of userInputEvents) {
    ownerWindow.addEventListener(eventName, markUserScroll, eventOptions);
  }

  refresh();

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearPendingFrame();
      if (guardTimer !== undefined) ownerWindow.clearTimeout(guardTimer);
      scrollElement?.removeAttribute(PAGE_EDITOR_SCROLL_ANCHORING_ATTRIBUTE);
      ownerWindow.removeEventListener('scroll', onScroll);
      ownerWindow.removeEventListener('resize', onResize);
      ownerDocument.removeEventListener('selectionchange', onSelectionChange);
      scrollElement?.removeEventListener('scroll', onScroll);
      for (const eventName of userInputEvents) {
        ownerWindow.removeEventListener(eventName, markUserScroll, eventOptions);
      }
    },
    handleRemoteUpdate,
    refresh,
  };
};
