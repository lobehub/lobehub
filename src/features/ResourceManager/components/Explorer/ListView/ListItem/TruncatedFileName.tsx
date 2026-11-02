import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface TruncatedFileNameProps {
  className?: string;
  name: string;
}

const ELLIPSIS = '...';

/** Rendered width of `name.slice(start, end)`. */
export type MeasureRange = (start: number, end: number) => number;

/**
 * Middle-truncate `name` so it fits `maxWidth`, keeping the extension (the
 * macOS Finder behaviour).
 */
export const truncateFileNameToWidth = (
  name: string,
  maxWidth: number,
  measureRange: MeasureRange,
  ellipsisWidth: number,
): string => {
  if (measureRange(0, name.length) <= maxWidth) return name;

  // Only treat it as an extension when the dot is not leading and has content after it
  const lastDotIndex = name.lastIndexOf('.');
  const baseEnd = lastDotIndex > 0 && lastDotIndex < name.length - 1 ? lastDotIndex : name.length;
  const extension = name.slice(baseEnd);

  const availableWidth = maxWidth - ellipsisWidth - measureRange(baseEnd, name.length);
  if (availableWidth <= 0) return `${ELLIPSIS}${extension}`;

  const split = (length: number) => [Math.ceil(length / 2), Math.floor(length / 2)] as const;
  const widthOf = (length: number) => {
    const [headChars, tailChars] = split(length);
    return measureRange(0, headChars) + measureRange(baseEnd - tailChars, baseEnd);
  };

  // Binary search the longest head + tail that still fits
  let left = 0;
  let right = baseEnd;
  let best = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);

    if (widthOf(mid) <= availableWidth) {
      best = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  if (best === 0) return `${ELLIPSIS}${extension}`;

  const [headChars, tailChars] = split(best);
  return `${name.slice(0, headChars)}${ELLIPSIS}${name.slice(baseEnd - tailChars, baseEnd)}${extension}`;
};

interface CharacterMetrics {
  /** Rendered width of the full name. */
  fullWidth: number;
  measureRange: MeasureRange;
  name: string;
}

/**
 * Character edges of the rendered full name, read on demand through a Range and
 * memoized for one measurement pass: the binary search only touches ~2·log₂(n)
 * of them. Reads only, no DOM
 * writes, so measuring every row a commit mounts costs a single layout.
 */
const createCharacterMetrics = (node: Text, name: string, fullWidth: number) => {
  const range = document.createRange();
  const left: number[] = [];
  const right: number[] = [];
  let origin: number | undefined;

  const edges = (index: number) => {
    if (left[index] === undefined) {
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      left[index] = rect.left;
      right[index] = rect.right;
    }
    return [left[index], right[index]] as const;
  };

  const startX = () => (origin ??= edges(0)[0]);

  const measureRange: MeasureRange = (start, end) => {
    if (end <= start) return 0;
    if (start === 0 && end === name.length) return fullWidth;
    return edges(end - 1)[1] - (start === 0 ? startX() : edges(start)[0]);
  };

  return { fullWidth, measureRange, name } satisfies CharacterMetrics;
};

const truncateWithMetrics = (
  { fullWidth, measureRange, name }: CharacterMetrics,
  width: number,
) => {
  if (fullWidth <= width) return name;

  // The extension dot gives the real width of "."; without one, approximate the
  // ellipsis by three average glyphs.
  const dotIndex = name.lastIndexOf('.');
  const dotWidth = dotIndex >= 0 ? measureRange(dotIndex, dotIndex + 1) : 0;
  const ellipsisWidth =
    (dotWidth > 0 ? dotWidth : fullWidth / Math.max(name.length, 1)) * ELLIPSIS.length;

  return truncateFileNameToWidth(name, width, measureRange, ellipsisWidth);
};

/**
 * Truncates file name from the center, preserving the extension at the end
 * Similar to macOS Finder behavior
 *
 * Measurement is read-only and happens in one layout effect while the full
 * name is rendered: its scroll width first, then only the character edges the
 * binary search needs, through a Range. A commit that mounts many rows
 * therefore lays the page out once. A real width change renders the full name
 * again and re-measures, so edges are never read from an already-truncated
 * text node. The previous version probed widths with a temporary span appended
 * to `body`, forcing a synchronous reflow per probe — a dozen per row mount —
 * which stalled every scroll step that mounted new rows.
 */
const TruncatedFileName = memo<TruncatedFileNameProps>(({ name, className }) => {
  const containerRef = useRef<HTMLSpanElement>(null);
  const measuredWidthRef = useRef<number | null>(null);
  // Bumped on a width change so the full name renders and is measured again.
  const [measureEpoch, setMeasureEpoch] = useState(0);
  const [truncated, setTruncated] = useState<{
    epoch: number;
    name: string;
    text: string;
  } | null>(null);

  // Until this name is measured at the current width, render it in full.
  const displayName =
    truncated?.name === name && truncated.epoch === measureEpoch ? truncated.text : name;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const node = container.firstChild;
    if (!(node instanceof Text) || node.data !== name) return;

    const width = container.clientWidth;
    measuredWidthRef.current = width;
    if (width <= 0) return;

    const metrics = createCharacterMetrics(node, name, container.scrollWidth);
    const text = truncateWithMetrics(metrics, width);
    setTruncated({ epoch: measureEpoch, name, text });
  }, [name, measureEpoch]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      const measured = measuredWidthRef.current;
      // The initial observation and sub-pixel noise are not a resize.
      if (measured !== null && Math.abs(width - measured) < 0.5) return;
      setMeasureEpoch((epoch) => epoch + 1);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <span className={className} ref={containerRef} title={name}>
      {displayName}
    </span>
  );
});

TruncatedFileName.displayName = 'TruncatedFileName';

export default TruncatedFileName;
