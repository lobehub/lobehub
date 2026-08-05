import { type MouseEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { useNaturalHeight } from './useNaturalHeight';

const VIEWPORT_RATIO = 0.35;

interface UseCollapsibleOptions {
  /** Controlled collapsed state. Omit to let the hook own it. */
  collapsed?: boolean;
  contentRef: RefObject<HTMLElement | null>;
  maxHeightLimit: number;
  onCollapsedChange?: (collapsed: boolean) => void;
  onOverflowChange?: (overflowing: boolean) => void;
  overflowThreshold: number;
}

/**
 * The clamp is capped by the viewport, not just the caller's limit: on a short
 * window a 280px preview is most of the screen.
 */
export const computeThreshold = (limit: number) => {
  if (typeof window === 'undefined') return limit;
  return Math.min(limit, Math.round(window.innerHeight * VIEWPORT_RATIO));
};

/**
 * Collapse state machine behind `CollapsibleContent`: resolves the effective
 * clamp, decides whether the overflow is even worth a toggle, and supports both
 * the self-managed and the controlled mode.
 */
export const useCollapsible = ({
  collapsed: collapsedProp,
  contentRef,
  maxHeightLimit,
  onCollapsedChange,
  onOverflowChange,
  overflowThreshold,
}: UseCollapsibleOptions) => {
  const [maxHeight, setMaxHeight] = useState(() => computeThreshold(maxHeightLimit));
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(true);
  const collapsed = collapsedProp ?? uncontrolledCollapsed;

  const naturalHeight = useNaturalHeight(contentRef);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => setMaxHeight(computeThreshold(maxHeightLimit));
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [maxHeightLimit]);

  const shouldCollapse = naturalHeight > maxHeight + overflowThreshold;

  // Held in a ref so an inline host callback doesn't re-fire the notification on
  // every render — only an actual overflow flip should reach the host. The
  // pre-measurement render reads as "fits", so hold the first report until the
  // element has a height, or every mount announces a false negative.
  const measured = naturalHeight > 0;
  const onOverflowChangeRef = useRef(onOverflowChange);
  onOverflowChangeRef.current = onOverflowChange;
  useEffect(() => {
    if (!measured) return;
    onOverflowChangeRef.current?.(shouldCollapse);
  }, [measured, shouldCollapse]);

  // Previews live inside clickable cards (a task run opens its drawer) — the
  // toggle must not also trigger the card.
  const toggle = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      const next = !collapsed;
      if (collapsedProp === undefined) setUncontrolledCollapsed(next);
      onCollapsedChange?.(next);
    },
    [collapsed, collapsedProp, onCollapsedChange],
  );

  return {
    /** Whether the clamp and fade mask are actually applied right now. */
    isCollapsed: shouldCollapse && collapsed,
    maxHeight,
    /** Whether the content overflows enough to deserve a toggle at all. */
    shouldCollapse,
    showAsCollapsed: collapsed,
    toggle,
  };
};
