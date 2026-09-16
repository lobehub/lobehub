'use client';

import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSingleton } from '@/hooks/useSingleton';

import { useCommentAnchors } from '../anchor/context';
import { GUTTER_CARD_GAP } from './constants';
import type { GutterLayoutEntry } from './layout';
import { gutterOverhangBottom, gutterOverhangTop, layoutGutterCards } from './layout';

/** Card id of the composer for the selection being commented on. */
export const PENDING_CARD_ID = 'pending';

/**
 * Marks the column the body sits in (title, meta bar, body). Its box is
 * watched alongside the body's: the title wrapping onto a second line moves
 * every run down without changing the body's own size.
 */
export const GUTTER_COLUMN_ATTRIBUTE = 'data-document-comment-column';

/**
 * The column animates its width when the pane is resized (see
 * `WideScreenContainer`), so the measurement taken on the resize event itself
 * sees the text mid-reflow. One more pass after the animation settles.
 */
const RESIZE_SETTLE_DELAY = 400;

const EMPTY_TOPS: ReadonlyMap<string, number> = new Map();

const sameTops = (left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>) => {
  if (left.size !== right.size) return false;
  for (const [id, top] of left) {
    if (right.get(id) !== top) return false;
  }
  return true;
};

/** The top of a run's first line, not of its bounding box — a run that wraps starts on its first line. */
const rangeTop = (range: Range) => {
  const rects = range.getClientRects();
  return (rects.length > 0 ? rects[0] : range.getBoundingClientRect()).top;
};

interface GutterLayoutParams {
  /** The card kept level with its run; see `layoutGutterCards`. */
  activeId: string | null;
  /** Whether the composer card for the pending selection is mounted. */
  hasPending: boolean;
  /** Root ids of the threads mounted in the panel, in any order. */
  ids: readonly string[];
  /** The body's scroll container; card positions are expressed in its content coordinates. */
  paneRef: RefObject<HTMLElement | null>;
  /** The element the cards are absolutely positioned in; it is translated to follow the pane's scroll. */
  trackRef: RefObject<HTMLElement | null>;
}

/**
 * Measure where every card's run sits and stack the cards to match.
 *
 * Positions are document coordinates — a run's viewport top plus the pane's
 * scroll offset — so they hold while the pane scrolls. The track holding the
 * cards is translated to mirror that scroll on every frame it changes, which
 * is a style write, never a re-measure. Only things that move text — an
 * edit, a reflow, a resize — or change a card's height trigger a re-measure.
 */
export const useGutterLayout = ({
  activeId,
  hasPending,
  ids,
  paneRef,
  trackRef,
}: GutterLayoutParams) => {
  const { bodyElement, getAnchorMatch, getAnchorRange, getPendingAnchorRange, resolvedAt } =
    useCommentAnchors();
  const [tops, setTops] = useState<ReadonlyMap<string, number>>(EMPTY_TOPS);
  const topsRef = useRef(tops);
  const elements = useSingleton(() => new Map<string, HTMLElement>());
  const observerRef = useRef<ResizeObserver | null>(null);
  const frameRef = useRef<number | undefined>(undefined);
  const scrollFrameRef = useRef<number | undefined>(undefined);
  /**
   * How far the stack hangs past each end of the pane's scroll range, in
   * pixels: cards above an active card near the first line are pushed up
   * past it, and a dense cluster near the last line stacks down past it.
   */
  const overhangRef = useRef({ bottom: 0, top: 0 });
  /**
   * The panel's own scroll past the pane's ends. The pane cannot scroll to
   * where the overhang sits and the document must not grow to make room, so
   * once the pane is at an end a wheel over the panel moves the track alone:
   * positive pulls the stack down to reveal cards above the first line,
   * negative pulls it up to reveal cards below the last.
   */
  const overscrollRef = useRef(0);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const hasPendingRef = useRef(hasPending);
  hasPendingRef.current = hasPending;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  /**
   * The overscroll a scroll position can use: the overhang at that end less
   * the distance the pane still has to reach it. As the reader scrolls the
   * document away from the end, the pull eases off and the cards settle back
   * beside their runs.
   */
  const clampOverscroll = useCallback((pane: HTMLElement, value: number) => {
    const { bottom, top } = overhangRef.current;
    const maxScroll = Math.max(0, pane.scrollHeight - pane.clientHeight);
    const upper = Math.max(0, top - pane.scrollTop);
    const lower = -Math.max(0, bottom - (maxScroll - pane.scrollTop));
    return Math.min(upper, Math.max(lower, value));
  }, []);

  // The track's parent clips it, so the translate is relative to that parent:
  // where the pane's content top sits in the panel's own coordinate space,
  // plus whatever the reader has pulled the stack past the pane's end.
  const syncTrack = useCallback(() => {
    scrollFrameRef.current = undefined;
    const pane = paneRef.current;
    const track = trackRef.current;
    const host = track?.parentElement;
    if (!pane || !track || !host) return;
    overscrollRef.current = clampOverscroll(pane, overscrollRef.current);
    const offset =
      pane.getBoundingClientRect().top -
      host.getBoundingClientRect().top -
      pane.scrollTop +
      overscrollRef.current;
    track.style.transform = `translateY(${Math.round(offset)}px)`;
  }, [clampOverscroll, paneRef, trackRef]);

  /**
   * Scroll the document by a wheel over the panel. The pane takes the
   * distance while it can; what it cannot take at either end goes into the
   * panel's own overscroll, up to the overhang there. Any overscroll in the
   * opposite direction is unwound first, so the stack always returns to its
   * runs before the document moves.
   */
  const scrollBy = useCallback(
    (delta: number) => {
      const pane = paneRef.current;
      if (!pane || delta === 0) return;
      const maxScroll = Math.max(0, pane.scrollHeight - pane.clientHeight);
      let over = clampOverscroll(pane, overscrollRef.current);
      let remaining = delta;
      if (remaining > 0) {
        if (over > 0) {
          const unwind = Math.min(over, remaining);
          over -= unwind;
          remaining -= unwind;
        }
        if (remaining > 0) {
          const room = Math.max(0, maxScroll - pane.scrollTop);
          const take = Math.min(room, remaining);
          if (take > 0) pane.scrollTop += take;
          remaining -= take;
        }
        if (remaining > 0) over = clampOverscroll(pane, over - remaining);
      } else {
        let upward = -remaining;
        if (over < 0) {
          const unwind = Math.min(-over, upward);
          over += unwind;
          upward -= unwind;
        }
        if (upward > 0) {
          const take = Math.min(pane.scrollTop, upward);
          if (take > 0) pane.scrollTop -= take;
          upward -= take;
        }
        if (upward > 0) over = clampOverscroll(pane, over + upward);
      }
      overscrollRef.current = over;
      syncTrack();
    },
    [clampOverscroll, paneRef, syncTrack],
  );

  const scheduleSync = useCallback(() => {
    if (scrollFrameRef.current !== undefined || typeof window === 'undefined') return;
    scrollFrameRef.current = window.requestAnimationFrame(syncTrack);
  }, [syncTrack]);

  const measure = useCallback(() => {
    frameRef.current = undefined;
    const pane = paneRef.current;
    if (!pane) return;
    const host = trackRef.current?.parentElement;

    const layout = () => {
      const paneTop = pane.getBoundingClientRect().top;
      const contentTop = paneTop - pane.scrollTop;
      const entries: GutterLayoutEntry[] = [];

      const push = (id: string, range: Range | null, order: number) => {
        const element = elements.get(id);
        if (!range || !element) return;
        entries.push({
          anchorTop: rangeTop(range) - contentTop,
          height: element.offsetHeight,
          id,
          order,
        });
      };

      for (const id of idsRef.current) {
        push(id, getAnchorRange(id), getAnchorMatch(id)?.start ?? 0);
      }
      if (hasPendingRef.current) push(PENDING_CARD_ID, getPendingAnchorRange(), 0);

      const tops = layoutGutterCards(entries, {
        activeId: activeIdRef.current,
        gap: GUTTER_CARD_GAP,
      });
      // The clip box may start below the pane's top (the panel has its own
      // header), so a card at the pane's very top would be partly covered.
      const clipTop = host ? host.getBoundingClientRect().top - paneTop : 0;
      let stackBottom = 0;
      for (const { height, id } of entries) {
        stackBottom = Math.max(stackBottom, (tops.get(id) ?? 0) + height);
      }
      return { clipTop, stackBottom, tops };
    };

    const result = layout();
    overhangRef.current = {
      bottom: host
        ? gutterOverhangBottom({
            hostBottom: host.getBoundingClientRect().bottom - pane.getBoundingClientRect().top,
            paneContentHeight: pane.scrollHeight,
            paneViewportHeight: pane.clientHeight,
            stackBottom: result.stackBottom,
          })
        : 0,
      top: gutterOverhangTop({ clipTop: result.clipTop, tops: result.tops }),
    };
    syncTrack();
    if (sameTops(topsRef.current, result.tops)) return;
    topsRef.current = result.tops;
    setTops(result.tops);
  }, [
    elements,
    getAnchorMatch,
    getAnchorRange,
    getPendingAnchorRange,
    paneRef,
    syncTrack,
    trackRef,
  ]);

  const schedule = useCallback(() => {
    if (frameRef.current !== undefined || typeof window === 'undefined') return;
    frameRef.current = window.requestAnimationFrame(measure);
  }, [measure]);

  // A card's height is part of the stack, so every card is watched for size
  // changes (replies loading, an edit box opening, an image finishing).
  const registerCard = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      const previous = elements.get(id);
      if (previous === element) return;
      if (previous) observerRef.current?.unobserve(previous);
      if (element) {
        elements.set(id, element);
        if (!observerRef.current && typeof ResizeObserver !== 'undefined') {
          observerRef.current = new ResizeObserver(schedule);
        }
        observerRef.current?.observe(element);
      } else {
        elements.delete(id);
      }
      schedule();
    },
    [elements, schedule],
  );

  const idsSignature = ids.join(' ');
  useEffect(() => {
    schedule();
  }, [activeId, hasPending, idsSignature, resolvedAt, schedule]);

  // Text reflows without its content changing — an image finishes loading,
  // the pane is resized, a font swaps in — so the body's box is watched, and
  // the column around it for anything above the body that changes height.
  useEffect(() => {
    if (!bodyElement || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(schedule);
    observer.observe(bodyElement);
    const column = bodyElement.closest(`[${GUTTER_COLUMN_ATTRIBUTE}]`);
    if (column) observer.observe(column);
    return () => observer.disconnect();
  }, [bodyElement, schedule]);

  // Scrolling only moves the track. The panel itself can move or resize (it
  // is draggable), which its own ResizeObserver covers.
  useEffect(() => {
    const pane = paneRef.current;
    const host = trackRef.current?.parentElement;
    if (!pane) return;
    pane.addEventListener('scroll', scheduleSync, { passive: true });
    const observer =
      host && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (host) observer?.observe(host);
    scheduleSync();
    return () => {
      pane.removeEventListener('scroll', scheduleSync);
      observer?.disconnect();
    };
  }, [paneRef, schedule, scheduleSync, trackRef]);

  useEffect(() => {
    let settle: ReturnType<typeof setTimeout> | undefined;
    const handleResize = () => {
      schedule();
      if (settle !== undefined) clearTimeout(settle);
      settle = setTimeout(schedule, RESIZE_SETTLE_DELAY);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (settle !== undefined) clearTimeout(settle);
      // A frame that is still pending here (the tab was in the background,
      // so no frame was ever painted) is cancelled together with the
      // scheduler that requested it. The slot has to be released too: the
      // next scheduler only requests a frame when none is pending, and a
      // cancelled id left behind would read as one — no card would ever be
      // measured again.
      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = undefined;
      }
      if (scrollFrameRef.current !== undefined) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = undefined;
      }
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [schedule]);

  return useMemo(() => ({ registerCard, scrollBy, tops }), [registerCard, scrollBy, tops]);
};
