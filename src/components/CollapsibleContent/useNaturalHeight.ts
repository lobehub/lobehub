import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * Tracks an element's natural (unconstrained) height, read from `scrollHeight`
 * so a `max-height` clamp on the element itself does not affect it.
 */
export const useNaturalHeight = (ref: RefObject<HTMLElement | null>) => {
  const [naturalHeight, setNaturalHeight] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const next = el.scrollHeight;
      setNaturalHeight((prev) => (prev === next ? prev : next));
    };
    measure();

    if (typeof ResizeObserver === 'undefined') return;

    // A subtree that stops being rendered — an inactive desktop tab kept alive
    // behind `display: none` — reports a zero box, and its `scrollHeight` reads
    // 0. Measuring that would drop the height to zero and restore it on reveal,
    // costing two forced layouts and a visible flip for content that never
    // changed. Keep the last real measurement instead.
    const observer = new ResizeObserver((entries) => {
      const box = entries.at(-1)?.contentRect;
      if (box && box.width === 0 && box.height === 0) return;
      measure();
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, [ref]);

  return naturalHeight;
};
