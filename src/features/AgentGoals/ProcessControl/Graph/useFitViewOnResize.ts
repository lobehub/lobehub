import type { FitViewOptions } from '@xyflow/react';
import { type RefObject, useEffect } from 'react';

const RESIZE_SETTLE_DELAY = 100;

export const observeWidth = (element: HTMLElement, onSettledResize: () => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let width = element.getBoundingClientRect().width;

  const observer = new ResizeObserver(([entry]) => {
    const nextWidth = entry?.contentRect.width;
    if (nextWidth === undefined || nextWidth === width) return;

    width = nextWidth;
    if (timer) clearTimeout(timer);
    timer = setTimeout(onSettledResize, RESIZE_SETTLE_DELAY);
  });

  observer.observe(element);

  return () => {
    if (timer) clearTimeout(timer);
    observer.disconnect();
  };
};

/** Reframe the graph after a surrounding panel changes the canvas width. */
export const useFitViewOnResize = (
  containerRef: RefObject<HTMLDivElement | null>,
  fitView: (options?: FitViewOptions) => Promise<boolean>,
  options: FitViewOptions,
  enabled = true,
) => {
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    return observeWidth(container, () => void fitView(options));
  }, [containerRef, enabled, fitView, options]);
};
