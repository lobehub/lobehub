'use client';

import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ANCHOR_ATTR,
  ANCHOR_LABEL_ATTR,
  ANCHOR_LEVEL_ATTR,
  JUMP_MARGIN,
  MIN_RAIL_ANCHORS,
  pickActiveAnchor,
  READING_LINE,
  type ResultAnchor,
  sameAnchors,
} from './resultAnchors';

/**
 * A scroll rail for the long 结果交付 page. At rest it is a column of ticks in
 * the page's right padding — one per section, shorter ones for the deliverable
 * groups inside 交付物 — with the section being read highlighted. Hovering it,
 * or tabbing to it, opens the section names; clicking one scrolls there.
 *
 * It sits beside the scrollbar and reads its anchors from the DOM, so it needs
 * no knowledge of which sections a given Goal renders, and it follows the page
 * as filters and acceptance data change underneath it.
 */

/** How far below the scroller's top edge the rail pins itself. */
const RAIL_TOP = 96;

/**
 * The rail belongs to the page's right edge, not to the column the sections are
 * laid out in. At rest the ticks sit this far inside the scroller's right edge,
 * and never closer than RAIL_EDGE_MIN to the column's own edge — so a narrowed
 * column (the document panel open) keeps them outside the text, and a wide one
 * puts them against the page instead of inside the container.
 */
const RAIL_MARGIN = 16;
const RAIL_EDGE_MIN = 8;

const styles = createStaticStyles(({ css }) => ({
  host: css`
    position: sticky;
    z-index: 10;
    inset-block-start: ${RAIL_TOP}px;
    height: 0;
  `,
  item: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: flex-end;

    width: 100%;

    /* Fixed, not a minimum: a row that grows taller when the labels open slides
       every tick below it out from under the pointer between hover and click. */
    height: 16px;
    padding: 0;
    border: none;

    color: ${cssVar.colorTextTertiary};
    text-align: end;

    background: none;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  itemActive: css`
    color: ${cssVar.colorText};
  `,
  label: css`
    overflow: hidden;
    display: none;
    flex: 1;

    max-width: 240px;

    font-size: 12px;

    /* Matches the row height, so opening the labels changes nothing vertically. */
    line-height: 16px;
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  labelChild: css`
    padding-inline-start: 12px;
  `,
  rail: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline-end: -16px;

    overflow: hidden auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;

    max-height: calc(100vh - ${RAIL_TOP * 2}px);
    padding-block: 6px;

    /* The end padding must not change when the labels open: the ticks are
       anchored to this edge, and a tick that moves out from under the pointer
       between hover and click is a click that goes nowhere. */
    padding-inline: 2px 8px;
    border: 1px solid transparent;
    border-radius: ${cssVar.borderRadiusLG};

    transition:
      background 0.15s ${cssVar.motionEaseOut},
      box-shadow 0.15s ${cssVar.motionEaseOut};

    /* Hover, or keyboard focus: a click leaves focus behind, and an open panel
       that outlives the gesture would cover the page it just navigated. */
    &:hover,
    &:has(:focus-visible) {
      padding-inline-start: 12px;
      border-color: ${cssVar.colorBorderSecondary};
      background: ${cssVar.colorBgElevated};
      box-shadow: ${cssVar.boxShadowSecondary};

      .result-anchor-label {
        display: block;
      }
    }
  `,
  tick: css`
    flex: none;

    width: 12px;
    height: 2px;
    border-radius: 1px;

    background: ${cssVar.colorFill};
  `,
  tickActive: css`
    background: ${cssVar.colorText};
  `,
  tickChild: css`
    width: 7px;
  `,
}));

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

interface ResultAnchorRailProps {
  rootRef: RefObject<HTMLElement | null>;
}

const ResultAnchorRail = ({ rootRef }: ResultAnchorRailProps) => {
  const { t } = useTranslation('chat');
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
    observer.observe(root, { childList: true, subtree: true });
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

  if (anchors.length < MIN_RAIL_ANCHORS) return null;

  const jumpTo = (id: string) => {
    const root = rootRef.current;
    const scroller = root && scrollParentOf(root);
    const section = root && anchorElement(root, id);
    if (!scroller || !section) return;
    const sectionTop =
      section.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    scroller.scrollTo({
      behavior: 'smooth',
      top: Math.min(
        Math.max(0, sectionTop - JUMP_MARGIN),
        Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      ),
    });
  };

  return (
    <div className={styles.host} ref={hostRef}>
      <nav
        aria-label={t('goalProcess.result.nav.label')}
        className={styles.rail}
        data-testid={'goal-result-anchor-rail'}
        style={{ insetInlineEnd: edge }}
      >
        {anchors.map((anchor, index) => {
          const isActive = index === active;
          return (
            <button
              aria-current={isActive ? 'location' : undefined}
              aria-label={anchor.label}
              className={cx(styles.item, isActive && styles.itemActive)}
              key={anchor.id}
              type={'button'}
              onClick={() => jumpTo(anchor.id)}
            >
              <span
                className={cx(
                  'result-anchor-label',
                  styles.label,
                  anchor.level === 1 && styles.labelChild,
                )}
              >
                {anchor.label}
              </span>
              <span
                className={cx(
                  styles.tick,
                  anchor.level === 1 && styles.tickChild,
                  isActive && styles.tickActive,
                )}
              />
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default ResultAnchorRail;
