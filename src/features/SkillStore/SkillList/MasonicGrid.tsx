'use client';

import { useSize } from 'ahooks';
import { useMasonry, usePositioner, useResizeObserver } from 'masonic';
import {
  type ComponentType,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useDensityTokens } from '@/styles/density';

import { masonicGridStyles } from './style';

/** Below this width the grid drops to one column, like `responsive.sm`. */
const SINGLE_COLUMN_WIDTH = 576;
/** A skill / MCP card: 40px avatar, title and description, padded. */
const ITEM_HEIGHT_ESTIMATE = 72;
/** Scroll updates are batched to at most this many renders a second. */
const SCROLL_FPS = 30;
/** How long after the last scroll event the list stops counting as scrolling. */
const SCROLL_IDLE_MS = 150;
/** How many rows from the end the next page starts loading. */
const END_THRESHOLD = 8;

interface ScrollState {
  height: number;
  isScrolling: boolean;
  scrollTop: number;
}

/** The scroll box's position and height, re-read at most `SCROLL_FPS` times a second. */
const useScrollState = (element: HTMLElement | null) => {
  const [state, setState] = useState<ScrollState>({ height: 0, isScrolling: false, scrollTop: 0 });

  useEffect(() => {
    if (!element) return;
    let frame = 0;
    let last = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;

    const read = (isScrolling: boolean) =>
      setState((prev) => {
        const next = { height: element.clientHeight, isScrolling, scrollTop: element.scrollTop };
        return prev.height === next.height &&
          prev.isScrolling === next.isScrolling &&
          prev.scrollTop === next.scrollTop
          ? prev
          : next;
      });

    const onScroll = () => {
      clearTimeout(idle);
      idle = setTimeout(() => read(false), SCROLL_IDLE_MS);
      if (frame) return;
      frame = requestAnimationFrame((now) => {
        frame = 0;
        if (now - last < 1000 / SCROLL_FPS) {
          // Too soon: try again next frame so the last position still lands.
          onScroll();
          return;
        }
        last = now;
        read(true);
      });
    };

    const resize = new ResizeObserver(() => read(false));
    resize.observe(element);
    element.addEventListener('scroll', onScroll, { passive: true });
    read(false);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(idle);
      resize.disconnect();
      element.removeEventListener('scroll', onScroll);
    };
  }, [element]);

  return state;
};

/**
 * Bumps when `items` stops extending the previous list. Masonic keeps every
 * cell's measured position, so a list that shrank or reordered (a new search)
 * needs a fresh positioner; one that only grew (the next page) keeps them.
 */
const useResetVersion = <T,>(items: T[], getKey: (item: T) => string) => {
  const keys = items.map(getKey);
  const [seen, setSeen] = useState({ keys, version: 0 });
  const same =
    keys.length === seen.keys.length && seen.keys.every((key, index) => key === keys[index]);
  if (!same) {
    const grew =
      keys.length > seen.keys.length && seen.keys.every((key, index) => key === keys[index]);
    setSeen({ keys, version: grew ? seen.version : seen.version + 1 });
  }
  return same ? seen.version : seen.version + 1;
};

interface MasonicGridProps<T extends object> {
  /** Below the rows, inside the scroll box: loading, error or end-of-list. */
  footer?: ReactNode;
  getKey: (item: T) => string;
  items: T[];
  /** Called once per page as the rows near the end of `items` come into view. */
  onEndReached?: () => void;
  renderItem: (item: T) => ReactNode;
}

interface GridProps<T extends object> extends MasonicGridProps<T> {
  gutter: number;
  /** Where the grid starts inside the scroll box (the list's top padding). */
  offset: number;
  scroll: ScrollState;
  width: number;
}

const Grid = <T extends object>({
  getKey,
  gutter,
  items,
  offset,
  onEndReached,
  renderItem,
  scroll,
  width,
}: GridProps<T>) => {
  const version = useResetVersion(items, getKey);
  const positioner = usePositioner(
    {
      columnCount: width < SINGLE_COLUMN_WIDTH ? 1 : 2,
      columnGutter: gutter,
      rowGutter: gutter,
      width,
    },
    [version],
  );
  const resizeObserver = useResizeObserver(positioner);

  // Masonic caches each cell element by its render component and data, so cells
  // read the latest `renderItem` from a ref instead of taking it as a prop.
  const renderRef = useRef(renderItem);
  useLayoutEffect(() => {
    renderRef.current = renderItem;
  });
  const Cell = useMemo<ComponentType<{ data: T; index: number; width: number }>>(
    () =>
      function SkillStoreGridCell({ data }) {
        return renderRef.current(data);
      },
    [],
  );

  // One call per length of `items`, so scrolling at the bottom asks for a page once.
  const requestedAt = useRef(-1);
  const onRender = useCallback(
    (_start: number, stop: number, rendered: T[]) => {
      if (!onEndReached || stop < rendered.length - END_THRESHOLD) return;
      if (requestedAt.current === rendered.length) return;
      requestedAt.current = rendered.length;
      onEndReached();
    },
    [onEndReached],
  );

  return useMasonry({
    height: scroll.height,
    isScrolling: scroll.isScrolling,
    itemHeightEstimate: ITEM_HEIGHT_ESTIMATE,
    itemKey: getKey,
    items,
    onRender,
    overscanBy: 2,
    positioner,
    render: Cell,
    resizeObserver,
    role: 'list',
    scrollTop: Math.max(0, scroll.scrollTop - offset),
    tabIndex: -1,
  });
};

/**
 * The Skill Store's scrolling two-column card list (masonic): only the cards
 * near the viewport are mounted, and the next page loads as the end nears.
 * In a hidden tab (no width yet) it renders no cards at all.
 */
const MasonicGrid = <T extends object>({ footer, ...props }: MasonicGridProps<T>) => {
  const { contentGap } = useDensityTokens();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const scroll = useScrollState(scroller);
  const width = useSize(container)?.width ?? 0;
  const offset = container?.offsetTop ?? 0;

  return (
    <div
      ref={setScroller}
      style={{ height: '60vh', overflowY: 'auto', position: 'relative', width: '100%' }}
    >
      <div className={masonicGridStyles.list}>
        <div ref={setContainer}>
          {scroll.height > 0 && width > 0 && (
            <Grid {...props} gutter={contentGap} offset={offset} scroll={scroll} width={width} />
          )}
        </div>
      </div>
      {footer}
    </div>
  );
};

export default memo(MasonicGrid) as typeof MasonicGrid;
