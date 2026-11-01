'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { RefObject } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TocHeading } from './headings';
import { collectHeadings, findActiveIndex, findBodyRoot, isSameOutline } from './headings';

/** A heading counts as "being read" once it scrolls within this distance of the pane top. */
const ACTIVE_THRESHOLD = 96;
const SCROLL_MARGIN = 24;
const MIN_HEADINGS = 2;
// Kept tight to the pane edge: the strip the rail takes is width wide tables lose.
const RAIL_INSET = 4;
const RAIL_PADDING_INLINE = 4;

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const styles = stylex.create({
  container: {
    alignItems: 'flex-end',
    // PageEditor drops the table gutter at the same breakpoint.
    display: { 'default': 'flex', '@media (max-width: 1024px)': 'none' },
    flexDirection: 'column',
    // Vertically centered on the right edge, like Notion's outline rail.
    insetBlockStart: '50%',
    insetInlineEnd: RAIL_INSET,
    position: 'absolute',
    transform: 'translateY(-50%)',
    zIndex: 10,
  },
  item: {
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    borderRadius: 6,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    cursor: 'pointer',
    fontSize: 13,
    lineHeight: 1.4,
    overflow: 'hidden',
    paddingBlock: 4,
    paddingInlineEnd: 8,
    textOverflow: 'ellipsis',
    transition: 'background-color 0.15s',
    whiteSpace: 'nowrap',
    width: '100%',
  },
  itemIndent: (indent: number) => ({ paddingInlineStart: indent }),
  itemActive: {
    color: { 'default': cssVar.colorPrimary, ':hover': cssVar.colorPrimary },
    fontWeight: 500,
  },
  line: {
    backgroundColor: cssVar.colorFill,
    borderRadius: 1,
    height: 2,
    transition: 'background-color 0.15s',
  },
  lineWidth: (width: number) => ({ width }),
  lineActive: {
    backgroundColor: cssVar.colorText,
  },
  lines: {
    alignItems: 'flex-end',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    paddingBlock: 8,
    paddingInline: RAIL_PADDING_INLINE,
  },
  panel: {
    backgroundColor: cssVar.colorBgElevated,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 10,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: cssVar.boxShadowSecondary,
    insetBlockStart: '50%',
    insetInlineEnd: 0,
    maxHeight: 'min(480px, 60vh)',
    overflowY: 'auto',
    padding: 6,
    position: 'absolute',
    transform: 'translateY(-50%)',
    width: 240,
  },
  title: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    paddingBlockStart: '4px',
    paddingBlockEnd: '6px',
    paddingInline: 8,
  },
});

const LINE_WIDTH: Record<TocHeading['level'], number> = { 1: 20, 2: 14, 3: 9 };
const ITEM_INDENT: Record<TocHeading['level'], number> = { 1: 8, 2: 20, 3: 32 };

/** Width of the strip the rail (including its hover area) takes from the pane's inline end. */
export const TOC_RAIL_GUTTER = RAIL_INSET + RAIL_PADDING_INLINE * 2 + LINE_WIDTH[1];

interface TableOfContentsProps {
  /** Element holding the page body; its first Lexical root is the outline source. */
  contentRef: RefObject<HTMLElement | null>;
  /** Called when the rail appears or disappears, so the pane can keep content out of its way. */
  onVisibleChange?: (visible: boolean) => void;
  /** Scrollable pane wrapping the body. */
  scrollRef: RefObject<HTMLElement | null>;
}

const TableOfContents = memo<TableOfContentsProps>(({ contentRef, onVisibleChange, scrollRef }) => {
  const { t } = useTranslation('file');
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [expanded, setExpanded] = useState(false);
  // A clicked heading near the end of the page may never reach the top of the
  // pane, so it stays active until the user scrolls on their own. Pinning the
  // element rather than its index drops the pin once the heading is gone, e.g.
  // after switching to another document.
  const pinnedRef = useRef<HTMLElement | null>(null);

  const updateActive = useCallback(
    (list: TocHeading[]) => {
      const pane = scrollRef.current;
      if (!pane) return;

      if (pinnedRef.current) {
        const pinnedIndex = list.findIndex(({ element }) => element === pinnedRef.current);
        if (pinnedIndex !== -1) {
          setActiveIndex(pinnedIndex);
          return;
        }
        pinnedRef.current = null;
      }

      const paneTop = pane.getBoundingClientRect().top;
      // A page that fits in the pane has nothing to scroll and starts at the top.
      const atBottom =
        pane.scrollHeight > pane.clientHeight &&
        pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1;
      setActiveIndex(
        findActiveIndex(
          list.map(({ element }) => element.getBoundingClientRect().top - paneTop),
          ACTIVE_THRESHOLD,
          atBottom,
        ),
      );
    },
    [scrollRef],
  );

  // Follow the body as it is edited or loaded; the Lexical root itself can be
  // replaced when switching documents, so observe the whole content subtree.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = collectHeadings(findBodyRoot(content));
        // Ordinary text edits leave the outline unchanged; keep the previous list
        // so the TOC does not rerender or reinstall its scroll listeners.
        setHeadings((prev) => (isSameOutline(prev, next) ? prev : next));
        updateActive(next);
      });
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(content, { characterData: true, childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [contentRef, updateActive]);

  useEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;

    let frame = 0;
    const handleScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => updateActive(headings));
    };

    const releasePin = () => {
      pinnedRef.current = null;
    };

    pane.addEventListener('scroll', handleScroll, { passive: true });
    // Pointer input covers scrollbar clicks and thumb drags.
    pane.addEventListener('pointerdown', releasePin, { passive: true });
    pane.addEventListener('wheel', releasePin, { passive: true });
    pane.addEventListener('touchstart', releasePin, { passive: true });
    pane.addEventListener('keydown', releasePin);

    // Opening a side panel, resizing the window or late reflow moves headings
    // without a scroll event.
    const resizeObserver = new ResizeObserver(handleScroll);
    resizeObserver.observe(pane);
    if (contentRef.current) resizeObserver.observe(contentRef.current);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      pane.removeEventListener('scroll', handleScroll);
      pane.removeEventListener('pointerdown', releasePin);
      pane.removeEventListener('wheel', releasePin);
      pane.removeEventListener('touchstart', releasePin);
      pane.removeEventListener('keydown', releasePin);
    };
  }, [contentRef, headings, scrollRef, updateActive]);

  const scrollToHeading = useCallback(
    (heading: TocHeading, index: number) => {
      const pane = scrollRef.current;
      if (!pane) return;

      pinnedRef.current = heading.element;
      setActiveIndex(index);

      const offset = heading.element.getBoundingClientRect().top - pane.getBoundingClientRect().top;
      pane.scrollTo({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        top: pane.scrollTop + offset - SCROLL_MARGIN,
      });
    },
    [scrollRef],
  );

  const visible = headings.length >= MIN_HEADINGS;

  useEffect(() => {
    onVisibleChange?.(visible);
  }, [onVisibleChange, visible]);

  useEffect(() => () => onVisibleChange?.(false), [onVisibleChange]);

  if (!visible) return null;

  return (
    <nav
      aria-label={t('pageEditor.toc.title')}
      {...stylex.props(styles.container)}
      onFocus={() => setExpanded(true)}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
      }}
    >
      {/* Focusable so keyboard users can open the panel the way hover does. */}
      <div
        aria-label={t('pageEditor.toc.title')}
        role="button"
        tabIndex={0}
        {...stylex.props(styles.lines)}
      >
        {headings.map((heading, index) => (
          <div
            key={index}
            {...stylex.props(
              styles.line,
              styles.lineWidth(LINE_WIDTH[heading.level]),
              index === activeIndex && styles.lineActive,
            )}
          />
        ))}
      </div>
      {expanded && (
        <div {...stylex.props(styles.panel)}>
          <div {...stylex.props(styles.title)}>{t('pageEditor.toc.title')}</div>
          {headings.map((heading, index) => (
            <div
              aria-current={index === activeIndex ? 'location' : undefined}
              key={index}
              role="link"
              {...stylex.props(
                styles.item,
                styles.itemIndent(ITEM_INDENT[heading.level]),
                index === activeIndex && styles.itemActive,
              )}
              tabIndex={0}
              title={heading.text}
              onClick={() => scrollToHeading(heading, index)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') scrollToHeading(heading, index);
              }}
            >
              {heading.text}
            </div>
          ))}
        </div>
      )}
    </nav>
  );
});

TableOfContents.displayName = 'PageTableOfContents';

export default TableOfContents;
