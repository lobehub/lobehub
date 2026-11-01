import { useCallback, useState } from 'react';

const isScrollable = (element: HTMLElement) => {
  const { overflowY } = getComputedStyle(element);
  return overflowY === 'auto' || overflowY === 'scroll';
};

/**
 * Resolve the nearest scrolling ancestor of an anchor element so a windowed
 * list (`react-virtuoso` `customScrollParent`) can attach to the page's own
 * scroller instead of nesting a second one. The anchor is attached via a
 * callback ref, so the parent resolves on mount and re-resolves when the
 * anchor is remounted under another container.
 */
export const useClosestScrollParent = () => {
  const [scrollParent, setScrollParent] = useState<HTMLElement>();

  const ref = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    let current = node.parentElement;
    while (current && !isScrollable(current)) current = current.parentElement;
    setScrollParent(current ?? undefined);
  }, []);

  return { ref, scrollParent };
};
