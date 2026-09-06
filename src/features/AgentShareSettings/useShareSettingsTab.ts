import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

export type ShareSettingsTab = 'access' | 'stats';

export const SHARE_SETTINGS_TAB_PARAM = 'tab';

const DEFAULT_TAB: ShareSettingsTab = 'access';

/** Anything but the one non-default value falls back, so a mistyped url never renders an empty page. */
export const parseShareSettingsTab = (value: string | null | undefined): ShareSettingsTab =>
  value === 'stats' ? 'stats' : DEFAULT_TAB;

/**
 * Active tab of the share settings page, kept in the `?tab=` search param so
 * the stats view is deep-linkable (e.g. from a spend-cap notification) and
 * survives a reload. The default tab is stored as the ABSENCE of the param to
 * keep the canonical url clean; switching uses `replace` so the tabs do not
 * pile up in browser history.
 */
export const useShareSettingsTab = (): [ShareSettingsTab, (tab: ShareSettingsTab) => void] => {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = parseShareSettingsTab(searchParams.get(SHARE_SETTINGS_TAB_PARAM));

  const setActive = useCallback(
    (tab: ShareSettingsTab) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === DEFAULT_TAB) next.delete(SHARE_SETTINGS_TAB_PARAM);
          else next.set(SHARE_SETTINGS_TAB_PARAM, tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [active, setActive];
};
