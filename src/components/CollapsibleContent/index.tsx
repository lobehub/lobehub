'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useCollapsible } from './useCollapsible';

const DEFAULT_MAX_HEIGHT = 280;
const DEFAULT_FADE_HEIGHT = 48;
// The fade must stay under one line-height, or the last visible line is a ghost
// and a short preview has nothing legible left in it.
const FADE_RATIO = 0.2;
// Only collapse when the overflow is meaningful; avoids hiding a button for a
// handful of extra pixels.
const OVERFLOW_THRESHOLD = 32;

const styles = stylex.create({
  container: { position: 'relative', width: '100%' },
  contentCollapsed: {
    overflow: 'hidden',
    maskImage: 'linear-gradient(to bottom, #000 calc(100% - var(--collapse-fade)), transparent)',
  },
  contentExpanded: { overflow: 'visible' },
  toggleButton: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    blockSize: '24px',
    paddingInline: '10px',
    borderStyle: 'none',
    borderRadius: '12px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': cssVar.colorFillQuaternary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: `color 150ms ${cssVar.motionEaseOut},
      background 150ms ${cssVar.motionEaseOut}`,
  },
  toggleWrapper: { display: 'flex', justifyContent: 'center', marginBlockStart: '6px' },
});

interface CollapsibleContentProps {
  children: ReactNode;
  /** Controlled collapsed state. Omit to let the component own it. Pass it when something outside the toggle expands the content — an editor gaining focus, for instance. */
  collapsed?: boolean;
  /** Upper bound for the collapsed height; the effective clamp also honours the viewport. */
  maxHeight?: number;
  /** Fires on toggle with the next collapsed state. Required for the controlled mode; also useful as a plain notification in the uncontrolled one. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Fires when the content crosses the overflow threshold, so the host can drop affordances that only make sense once nothing is hidden. */
  onOverflowChange?: (overflowing: boolean) => void;
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
 *
 * Collapsing is self-managed by default. Pass `collapsed` + `onCollapsedChange`
 * to drive it from outside — the task instruction expands on editor focus, so
 * one click both opens the preview and puts the caret where it was aimed.
 */
const CollapsibleContent = memo<CollapsibleContentProps>(
  ({
    children,
    collapsed: collapsedProp,
    maxHeight: maxHeightLimit = DEFAULT_MAX_HEIGHT,
    onCollapsedChange,
    onOverflowChange,
    overflowThreshold = OVERFLOW_THRESHOLD,
  }) => {
    const { t } = useTranslation('chat');
    const contentRef = useRef<HTMLDivElement | null>(null);

    const {
      isCollapsed,
      maxHeight,
      shouldCollapse,
      showAsCollapsed: collapsed,
      toggle,
    } = useCollapsible({
      collapsed: collapsedProp,
      contentRef,
      maxHeightLimit,
      onCollapsedChange,
      onOverflowChange,
      overflowThreshold,
    });

    return (
      <div {...stylex.props(styles.container)}>
        <div
          ref={contentRef}
          className={
            stylex.props(isCollapsed ? styles.contentCollapsed : styles.contentExpanded).className
          }
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
          <div {...stylex.props(styles.toggleWrapper)}>
            <button
              aria-expanded={!collapsed}
              {...stylex.props(styles.toggleButton)}
              type="button"
              onClick={toggle}
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
