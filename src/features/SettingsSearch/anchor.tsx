'use client';

import { createStaticStyles, cssVar } from 'antd-style';
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

const styles = createStaticStyles(({ css }) => ({
  anchor: css`
    scroll-margin-block-start: 80px;
  `,
  highlight: css`
    border-radius: ${cssVar.borderRadius};
    animation: settings-search-highlight 1.2s ease-in-out 2;

    @keyframes settings-search-highlight {
      0%,
      100% {
        background: transparent;
      }

      50% {
        /* One step above colorPrimaryBg — plain Bg is barely visible in dark mode */
        background: ${cssVar.colorPrimaryBgHover};
      }
    }

    @media (prefers-reduced-motion: reduce) {
      /* Keep the locate cue, drop the flashing: a steady highlight that the
         removal timer clears */
      background: ${cssVar.colorPrimaryBgHover};
      animation: none;
    }
  `,
}));

/**
 * Marks a settings section / item as a search target. Wrap the group title or
 * item label so `scrollToSettingsAnchor` can locate and highlight it. The `id`
 * must match a `SETTINGS_SEARCH_ITEMS` entry's `anchor`.
 */
export const SettingsSearchAnchor = memo<PropsWithChildren<{ id: string }>>(({ id, children }) => (
  <span className={styles.anchor} {...{ [SETTINGS_ANCHOR_ATTR]: id }}>
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
    target.classList.add(styles.highlight);
    setTimeout(() => target.classList.remove(styles.highlight), HIGHLIGHT_DURATION);
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
