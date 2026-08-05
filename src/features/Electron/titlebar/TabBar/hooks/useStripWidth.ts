'use client';

import { useEffect, useState } from 'react';

type StripRef = (node: HTMLDivElement | null) => void;

/**
 * Content-box width of the strip, plus the ref to attach to it. `contentRect` already
 * excludes the leading inset that clears the content card's top corner, so callers can
 * budget against it directly.
 *
 * A callback ref rather than `useRef`: TabBar returns null until its tabs load, so a
 * `[ref]`-keyed effect would run once against an unmounted strip, never observe
 * anything, and leave every tab pinned to its minimum width.
 */
export const useStripWidth = (): [number, StripRef] => {
  const [width, setWidth] = useState(0);
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!node) return;

    setWidth(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, [node]);

  return [width, setNode];
};
