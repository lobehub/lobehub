import { useCallback, useState } from 'react';

/**
 * Whether a group is folded open, and which of its two views is showing, are
 * per-browser reading preferences rather than conversation data: both live in
 * localStorage and are never written back to the message group.
 *
 * Both are read synchronously in the state initialiser instead of through
 * `useLocalStorageState`. That hook renders its default first and hydrates in an
 * effect, which is the right trade for a preference that only tweaks rendering —
 * but the fold decides whether a potentially very long summary renders at all, so
 * a deferred read paints the whole block and collapses it afterwards on every
 * mount, including each virtual-list remount, dragging the transcript's scroll
 * position around.
 */
export const compressedGroupTabKey = (id: string) => `compressed-group-tab:${id}`;

export const compressedGroupExpandedKey = (id: string) => `compressed-group-expanded:${id}`;

const readPreference = (key: string): string | null => {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writePreference = (key: string, value: string) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore write failures (private mode, quota)
  }
};

export const useGroupPreferences = (id: string) => {
  const [activeTab, setActiveTabState] = useState(
    () => readPreference(compressedGroupTabKey(id)) ?? 'summary',
  );
  const [expanded, setExpanded] = useState(
    () => readPreference(compressedGroupExpandedKey(id)) !== 'false',
  );

  const setActiveTab = useCallback(
    (tab: string) => {
      setActiveTabState(tab);
      writePreference(compressedGroupTabKey(id), tab);
    },
    [id],
  );

  const toggleExpanded = useCallback(() => {
    const next = !expanded;

    setExpanded(next);
    writePreference(compressedGroupExpandedKey(id), String(next));
  }, [expanded, id]);

  return { activeTab, expanded, setActiveTab, toggleExpanded };
};
