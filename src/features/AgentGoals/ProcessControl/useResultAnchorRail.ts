'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';

import {
  ANCHOR_ATTR,
  ANCHOR_LABEL_ATTR,
  ANCHOR_LEVEL_ATTR,
  JUMP_MARGIN,
  pickActiveAnchor,
  READING_LINE,
  type ResultAnchor,
  sameAnchors,
} from './resultAnchors';

/** How far below the scroller's top edge the rail pins itself. */
export const RAIL_TOP = 96;

/**
 * The rail belongs to the page's right edge, not to the column the sections are
 * laid out in. At rest the ticks sit this far inside the scroller's right edge,
 * and never closer than RAIL_EDGE_MIN to the column's own edge — so a narrowed
 * column (the document panel open) keeps them outside the text, and a wide one
 * puts them against the page instead of inside the container.
 */
export const RAIL_MARGIN = 16;
export const RAIL_EDGE_MIN = 8;

/**
 * One row per section, and the line-height the labels take inside it. Both use
 * this number: the row must stay exactly as tall with the labels open as with
 * them closed, or every tick below the pointer slides out from under it between
 * hover and click. Wide enough that the names do not read as a solid block.
 */
export const RAIL_ROW = 22;

const scrollParentOf = (element: HTMLElement): HTMLElement | null => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
};

const anchorElement = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLElement>(`[${ANCHOR_ATTR}="${CSS.escape(id)}"]`);

const readAnchors = (root: HTMLElement): ResultAnchor[] =>
  [...root.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTR}]`)]
    // A section that renders nothing leaves an empty wrapper behind.
    .filter((element) => element.offsetHeight > 0)
    .map((element) => ({
      id: element.getAttribute(ANCHOR_ATTR)!,
      label: element.getAttribute(ANCHOR_LABEL_ATTR) ?? '',
      level: element.getAttribute(ANCHOR_LEVEL_ATTR) === '1' ? 1 : 0,
    }));

interface UseResultAnchorRailOptions {
  rootRef: RefObject<HTMLElement | null>;
}

/**
 * Everything the rail knows: which sections the page is showing, which one the
 * reader is on, where the page's right edge is, and how to jump to a section. It
 * reads all of that from the DOM, so it needs no knowledge of which sections a
 * given Goal renders and it follows the page as filters and acceptance data
 * change underneath it.
 */
export const useResultAnchorRail = ({ rootRef }: UseResultAnchorRailOptions) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [anchors, setAnchors] = useState<ResultAnchor[]>([]);
  const [active, setActive] = useState(0);
  const [edge, setEdge] = useState(-RAIL_MARGIN);

  // Sections load and filters change after mount; re-read on DOM changes.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const scan = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = readAnchors(root);
        setAnchors((prev) => (sameAnchors(prev, next) ? prev : next));
      });
    };
    scan();
    const observer = new MutationObserver(scan);
    // Section titles are the tick labels, and a language switch rewrites those
    // attributes in place — nothing is added or removed — so watch them too, or
    // the rail keeps the previous language until some unrelated child appears.
    observer.observe(root, {
      attributeFilter: [ANCHOR_ATTR, ANCHOR_LABEL_ATTR],
      attributes: true,
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [rootRef]);

  useEffect(() => {
    const root = rootRef.current;
    const scroller = root && scrollParentOf(root);
    if (!root || !scroller || anchors.length === 0) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const readingLine = scroller.getBoundingClientRect().top + READING_LINE;
        const tops = anchors.map(
          (anchor) =>
            anchorElement(root, anchor.id)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
        );
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
        setActive(Math.max(0, pickActiveAnchor(tops, readingLine, atBottom)));

        // Measure where the page's right edge actually is rather than assuming
        // it: the document panel and the window both narrow the column under us.
        const host = hostRef.current;
        if (host) {
          const gap = scroller.getBoundingClientRect().right - host.getBoundingClientRect().right;
          setEdge(Math.min(-RAIL_EDGE_MIN, RAIL_MARGIN - gap));
        }
      });
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      resizeObserver.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [anchors, rootRef]);

  const jumpTo = (id: string) => {
    const root = rootRef.current;
    const scroller = root && scrollParentOf(root);
    const section = root && anchorElement(root, id);
    if (!scroller || !section) return;
    // The jump already moves the reader; the animation is the decoration on top
    // of it, so it is the part that goes when the reader asked for less motion.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sectionTop =
      section.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    scroller.scrollTo({
      behavior: reduceMotion ? 'auto' : 'smooth',
      top: Math.min(
        Math.max(0, sectionTop - JUMP_MARGIN),
        Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      ),
    });
  };

  return { active, anchors, edge, hostRef, jumpTo };
};
