import { useLayoutEffect, useState } from 'react';

export const resolveMasonryColumnCount = (width: number) => {
  if (width < 768) return 2;
  if (width < 1024) return 3;
  if (width < 1536) return 4;
  return 5;
};

const MASONRY_GAP = 16;
const MASONRY_MIN_CARD_WIDTH = 200;
const MASONRY_MIN_COLUMNS = 2;
const MASONRY_MAX_COLUMNS = 5;

/**
 * Column count for the masonry's own content width. The grid shares its row
 * with the detail panel, so the viewport says nothing about how much room the
 * cards really have: fit as many columns as keep each card at least
 * `MASONRY_MIN_CARD_WIDTH` wide, never fewer than two.
 */
export const resolveMasonryColumnCountByWidth = (contentWidth: number) =>
  Math.min(
    MASONRY_MAX_COLUMNS,
    Math.max(
      MASONRY_MIN_COLUMNS,
      Math.floor((contentWidth + MASONRY_GAP) / (MASONRY_MIN_CARD_WIDTH + MASONRY_GAP)),
    ),
  );

// Resolved synchronously on the first render: a default column count that is
// corrected in an effect re-lays out every masonry card one frame later.
export const useMasonryColumnCount = () => {
  const [columnCount, setColumnCount] = useState(() =>
    resolveMasonryColumnCount(typeof window === 'undefined' ? 1024 : window.innerWidth),
  );

  useLayoutEffect(() => {
    const updateColumnCount = () => setColumnCount(resolveMasonryColumnCount(window.innerWidth));

    updateColumnCount();
    window.addEventListener('resize', updateColumnCount);
    return () => window.removeEventListener('resize', updateColumnCount);
  }, []);

  return columnCount;
};

const getContentWidth = (element: HTMLElement) => {
  const style = window.getComputedStyle(element);
  return (
    element.clientWidth -
    Number.parseFloat(style.paddingInlineStart || '0') -
    Number.parseFloat(style.paddingInlineEnd || '0')
  );
};

/**
 * Masonry column count that follows the container (e.g. when the detail panel
 * opens beside the grid). Falls back to the viewport rule until the container
 * is mounted.
 */
export const useContainerMasonryColumnCount = (container: HTMLElement | null) => {
  const viewportColumnCount = useMasonryColumnCount();
  const [containerColumnCount, setContainerColumnCount] = useState<number>();

  useLayoutEffect(() => {
    if (!container) return;

    const update = () =>
      setContainerColumnCount(resolveMasonryColumnCountByWidth(getContentWidth(container)));

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  return containerColumnCount ?? viewportColumnCount;
};
