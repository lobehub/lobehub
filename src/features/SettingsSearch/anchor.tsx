'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type PropsWithChildren, useEffect } from 'react';
import { useLocation } from 'react-router';

export const SETTINGS_ANCHOR_ATTR = 'data-settings-anchor';
/**
 * Marks the row container to flash-highlight for anchors inside non-antd rows
 * (e.g. profile ProfileRow) — the highlight lookup falls back to this attribute
 * when no `.ant-form-item` ancestor exists.
 */
export const SETTINGS_ANCHOR_ROW_ATTR = 'data-settings-anchor-row';

const HIGHLIGHT_DURATION = 2400;
const POLL_INTERVAL = 100;
// Settings tabs are lazy-loaded, so the anchor node may not exist right after
// navigation — poll for a few seconds before giving up (fall back to a plain
// tab switch, which is still a correct result).
const POLL_TIMEOUT = 3000;

const highlightKeyframes = stylex.keyframes({
  '0%': { backgroundColor: 'transparent' },
  // One step above colorPrimaryBg — plain Bg is barely visible in dark mode
  '50%': { backgroundColor: cssVar.colorPrimaryBgHover },
  '100%': { backgroundColor: 'transparent' },
});

const styles = stylex.create({
  anchor: {
    scrollMarginBlockStart: '80px',
  },
  highlight: {
    borderRadius: cssVar.borderRadius,
    animationName: {
      'default': highlightKeyframes,
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    animationDuration: { 'default': '1.2s', '@media (prefers-reduced-motion: reduce)': '0s' },
    animationTimingFunction: {
      'default': 'ease-in-out',
      '@media (prefers-reduced-motion: reduce)': 'ease',
    },
    animationIterationCount: { 'default': 2, '@media (prefers-reduced-motion: reduce)': 1 },
    // Keep the locate cue, drop the flashing: a steady highlight that the
    // removal timer clears
    backgroundColor: {
      'default': null,
      '@media (prefers-reduced-motion: reduce)': cssVar.colorPrimaryBgHover,
    },
    backgroundImage: { 'default': null, '@media (prefers-reduced-motion: reduce)': 'none' },
  },
});

const highlightClassNames = (stylex.props(styles.highlight).className ?? '').split(' ');

/**
 * Marks a settings section / item as a search target. Wrap the group title or
 * item label so `scrollToSettingsAnchor` can locate and highlight it. The `id`
 * must match a `SETTINGS_SEARCH_ITEMS` entry's `anchor`.
 */
export const SettingsSearchAnchor = memo<PropsWithChildren<{ id: string }>>(({ id, children }) => (
  <span {...stylex.props(styles.anchor)} {...{ [SETTINGS_ANCHOR_ATTR]: id }}>
    {children}
  </span>
));

SettingsSearchAnchor.displayName = 'SettingsSearchAnchor';

/**
 * Scroll the anchor into view and flash-highlight its enclosing form row (or
 * group header). Safe to call before the target tab finishes rendering.
 * Returns a cancel function that stops the poll (the highlight timer is left
 * to finish — removing a CSS class on a detached node is harmless).
 */
export const scrollToSettingsAnchor = (anchor: string) => {
  const startAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tryScroll = () => {
    const el = document.querySelector(`[${SETTINGS_ANCHOR_ATTR}="${CSS.escape(anchor)}"]`);

    if (!el) {
      if (Date.now() - startAt < POLL_TIMEOUT) timer = setTimeout(tryScroll, POLL_INTERVAL);
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });

    // Highlight the whole form row / group header instead of the bare label
    // text so the flash is visible at a glance.
    const target =
      el.closest(`.ant-form-item, .ant-collapse-header, [${SETTINGS_ANCHOR_ROW_ATTR}]`) ?? el;
    target.classList.add(...highlightClassNames);
    setTimeout(() => target.classList.remove(...highlightClassNames), HIGHLIGHT_DURATION);
  };

  tryScroll();

  return () => clearTimeout(timer);
};

/**
 * Settings-search deep link: scroll to the `#anchor` item once the active tab
 * renders. Keyed on location.key so re-clicking the same result re-triggers;
 * navigating away cancels the in-flight poll.
 */
export const useSettingsAnchorScroll = () => {
  const location = useLocation();

  useEffect(() => {
    const anchor = location.hash.replace(/^#/, '');
    if (anchor) return scrollToSettingsAnchor(anchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
};
