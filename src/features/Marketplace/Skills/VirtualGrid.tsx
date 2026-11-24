import { useSize } from 'ahooks';
import { useMasonry, usePositioner, useResizeObserver } from 'masonic';
import {
  type ComponentType,
  createContext,
  memo,
  type ReactNode,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/** Two columns, 16px apart, rows 4px apart: the grid every Market list uses. */
const COLUMN_COUNT = 2;
const COLUMN_GUTTER = 16;
const ROW_GUTTER = 4;
/** A row is a 40px tile plus 8px above and below, then the gutter. */
const ROW_HEIGHT_ESTIMATE = 56 + ROW_GUTTER;
/** Scroll updates are batched to at most this many renders a second. */
const SCROLL_FPS = 30;
/** How long after the last scroll event the list stops counting as scrolling. */
const SCROLL_IDLE_MS = 150;

interface MarketScroll {
  height: number;
  isScrolling: boolean;
  scrollTop: number;
  viewport: HTMLElement | null;
}

const MarketScrollContext = createContext<MarketScroll | null>(null);

/**
 * The page's scroll container (found by its element id), shared by every grid
 * on the page, so a page of many groups listens to the scroll once rather than
 * once per group.
 */
export const MarketScrollProvider = ({
  children,
  viewportId,
}: {
  children: ReactNode;
  viewportId: string;
}) => {
  // `undefined` until looked up; `null` when the page has no such container.
  const [viewport, setViewport] = useState<HTMLElement | null | undefined>(undefined);
  const [state, setState] = useState({ height: 0, isScrolling: false, scrollTop: 0 });

  useEffect(() => {
    setViewport(document.getElementById(viewportId));
  }, [viewportId]);

  useEffect(() => {
    if (!viewport) return;
    let frame = 0;
    let last = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;

    const read = (isScrolling: boolean) =>
      setState((prev) => {
        const next = { height: viewport.clientHeight, isScrolling, scrollTop: viewport.scrollTop };
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
    resize.observe(viewport);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    read(false);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(idle);
      resize.disconnect();
      viewport.removeEventListener('scroll', onScroll);
    };
  }, [viewport]);

  const value = useMemo(
    () => (viewport === null ? null : { ...state, viewport: viewport ?? null }),
    [state, viewport],
  );

  return <MarketScrollContext value={value}>{children}</MarketScrollContext>;
};

/**
 * Bumps when `items` stops extending the previous list. Masonic keeps every
 * cell's measured position, so a list that shrank or reordered needs a fresh
 * positioner; one that only grew ("Load more") keeps its measurements.
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

/** Where `container` starts inside the viewport's scrolled content. */
const measureOffset = (container: HTMLElement, viewport: HTMLElement) =>
  container.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;

interface VirtualGridProps<T extends object> {
  getKey: (item: T) => string;
  items: T[];
  renderItem: (item: T) => ReactNode;
}

/** The masonic grid itself; mounted once its container has a width. */
const Grid = <T extends object>({
  container,
  getKey,
  items,
  renderItem,
  scroll,
  viewport,
  width,
}: VirtualGridProps<T> & {
  container: HTMLDivElement;
  scroll: MarketScroll;
  viewport: HTMLElement;
  width: number;
}) => {
  const version = useResetVersion(items, getKey);
  const positioner = usePositioner(
    {
      columnCount: COLUMN_COUNT,
      columnGutter: COLUMN_GUTTER,
      rowGutter: ROW_GUTTER,
      width,
    },
    [version],
  );
  const resizeObserver = useResizeObserver(positioner);

  // Measured up front so a grid below the fold renders none of its rows on mount.
  const [offset, setOffset] = useState(() => measureOffset(container, viewport));
  // Groups above the grid can change size, so the offset is re-read after every render.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const next = measureOffset(container, viewport);
    setOffset((prev) => (Math.abs(prev - next) < 1 ? prev : next));
  });

  // Masonic caches each cell element by its render component and data, so cells
  // read the latest `renderItem` from a ref instead of taking it as a prop.
  const renderRef = useRef(renderItem);
  useLayoutEffect(() => {
    renderRef.current = renderItem;
  });
  const Cell = useMemo<ComponentType<{ data: T; index: number; width: number }>>(
    () =>
      function MarketGridCell({ data }) {
        return renderRef.current(data);
      },
    [],
  );

  return useMasonry({
    height: scroll.height,
    isScrolling: scroll.isScrolling,
    itemHeightEstimate: ROW_HEIGHT_ESTIMATE,
    itemKey: getKey,
    items,
    overscanBy: 2,
    positioner,
    render: Cell,
    resizeObserver,
    role: 'list',
    // Negative while the grid is still below the viewport, so nothing of it renders yet.
    scrollTop: scroll.scrollTop - offset,
    tabIndex: -1,
  });
};

/**
 * A two-column Market list that only renders the rows near the viewport (masonic).
 * Rows below the fold keep their estimated space, so the scrollbar stays put.
 * Outside a scroll provider it renders every row.
 */
const VirtualGrid = <T extends object>(props: VirtualGridProps<T>) => {
  const scroll = use(MarketScrollContext);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const size = useSize(container);
  const width = size?.width ?? 0;

  if (!scroll)
    return (
      <div
        style={{
          columnGap: COLUMN_GUTTER,
          display: 'grid',
          gridTemplateColumns: `repeat(${COLUMN_COUNT}, minmax(0, 1fr))`,
          rowGap: ROW_GUTTER,
        }}
      >
        {props.items.map((item) => (
          <div key={props.getKey(item)}>{props.renderItem(item)}</div>
        ))}
      </div>
    );

  const { viewport } = scroll;
  const ready = container && viewport && scroll.height > 0 && width > 0;

  return (
    <div ref={setContainer}>
      {ready ? (
        <Grid {...props} container={container} scroll={scroll} viewport={viewport} width={width} />
      ) : (
        // Until the grid can measure, hold the space its rows will take.
        <div
          style={{ height: Math.ceil(props.items.length / COLUMN_COUNT) * ROW_HEIGHT_ESTIMATE }}
        />
      )}
    </div>
  );
};

export default memo(VirtualGrid) as typeof VirtualGrid;
