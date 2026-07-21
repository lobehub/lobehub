'use client';

import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const DEFAULT_MAX_HEIGHT = 280;
const DEFAULT_FADE_HEIGHT = 48;
// The fade must stay under one line-height, or the last visible line is a ghost
// and a short preview has nothing legible left in it.
const FADE_RATIO = 0.2;
const VIEWPORT_RATIO = 0.35;
// Only collapse when the overflow is meaningful; avoids hiding a button for a
// handful of extra pixels.
const OVERFLOW_THRESHOLD = 32;

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    position: relative;
    width: 100%;
  `,
  contentCollapsed: css`
    overflow: hidden;

    /* Fade height scales with the clamp — a fixed 48px would swallow most of a
       three-line preview and leave the last line unreadable. */
    mask-image: linear-gradient(to bottom, #000 calc(100% - var(--collapse-fade)), transparent);
  `,
  contentExpanded: css`
    overflow: visible;
  `,
  toggleButton: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    block-size: 24px;
    padding-inline: 10px;
    border: none;
    border-radius: 12px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};

    transition:
      color 150ms ${cssVar.motionEaseOut},
      background 150ms ${cssVar.motionEaseOut};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  toggleWrapper: css`
    display: flex;
    justify-content: center;
    margin-block-start: 6px;
  `,
}));

const computeThreshold = (limit: number) => {
  if (typeof window === 'undefined') return limit;
  return Math.min(limit, Math.round(window.innerHeight * VIEWPORT_RATIO));
};

interface CollapsibleContentProps {
  children: ReactNode;
  /** Upper bound for the collapsed height; the effective clamp also honours the viewport. */
  maxHeight?: number;
  /** How far content must overflow before collapsing is worth a toggle. Lower it for short previews, where a couple of hidden lines already matter. */
  overflowThreshold?: number;
}

/**
 * Collapses long content to a bounded max-height with a gradient mask and a
 * toggle button. Born in the user message bubble — where a long prompt would
 * otherwise push the AI response out of the viewport — and now the one collapse
 * behaviour shared by every long-content preview (task runs, inbox rows), so
 * "show more" looks and measures the same everywhere.
 *
 * The clamp is capped by the viewport, not just `maxHeight`: on a short window a
 * 280px preview is most of the screen.
 */
const CollapsibleContent = memo<CollapsibleContentProps>(
  ({
    children,
    maxHeight: maxHeightLimit = DEFAULT_MAX_HEIGHT,
    overflowThreshold = OVERFLOW_THRESHOLD,
  }) => {
    const { t } = useTranslation('chat');
    const contentRef = useRef<HTMLDivElement | null>(null);

    const [maxHeight, setMaxHeight] = useState(() => computeThreshold(maxHeightLimit));
    const [naturalHeight, setNaturalHeight] = useState(0);
    const [collapsed, setCollapsed] = useState(true);

    // Measure content's natural (unconstrained) height. We read scrollHeight so
    // the value is unaffected by our own max-height clamp.
    useLayoutEffect(() => {
      const el = contentRef.current;
      if (!el) return;

      const measure = () => {
        setNaturalHeight(el.scrollHeight);
      };
      measure();

      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      if (typeof window === 'undefined') return;

      const handleResize = () => setMaxHeight(computeThreshold(maxHeightLimit));
      handleResize();

      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [maxHeightLimit]);

    const shouldCollapse = naturalHeight > maxHeight + overflowThreshold;
    const isCollapsed = shouldCollapse && collapsed;

    // Previews live inside clickable cards (a task run opens its drawer) — the
    // toggle must not also trigger the card.
    const handleToggle = useCallback((e: MouseEvent) => {
      e.stopPropagation();
      setCollapsed((prev) => !prev);
    }, []);

    return (
      <div className={styles.container}>
        <div
          className={isCollapsed ? styles.contentCollapsed : styles.contentExpanded}
          ref={contentRef}
          style={
            isCollapsed
              ? ({
                  '--collapse-fade': `${Math.round(Math.min(DEFAULT_FADE_HEIGHT, maxHeight * FADE_RATIO))}px`,
                  maxHeight,
                } as CSSProperties)
              : undefined
          }
        >
          {children}
        </div>
        {shouldCollapse && (
          <div className={styles.toggleWrapper}>
            <button
              aria-expanded={!collapsed}
              className={styles.toggleButton}
              type="button"
              onClick={handleToggle}
            >
              {collapsed ? <ChevronDownIcon size={14} /> : <ChevronUpIcon size={14} />}
              {collapsed ? t('messageLongCollapse.expand') : t('messageLongCollapse.collapse')}
            </button>
          </div>
        )}
      </div>
    );
  },
);

CollapsibleContent.displayName = 'CollapsibleContent';

export default CollapsibleContent;
