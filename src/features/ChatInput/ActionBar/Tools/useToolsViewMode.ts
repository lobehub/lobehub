import { useCallback, useSyncExternalStore } from 'react';

export type ToolsViewMode = 'flat' | 'grouped';

const STORAGE_KEY = 'LOBE_TOOLS_VIEW_MODE';

const isViewMode = (value: null | string): value is ToolsViewMode =>
  value === 'flat' || value === 'grouped';

/**
 * Reading preference for the Tools list: the same rows either grouped by activation
 * state (Pinned / Auto / Disabled) or as one flat list.
 *
 * It only changes how rows are presented, never which tools are active, so it stays in
 * localStorage as a per-device preference instead of reaching `agents.chatConfig`.
 *
 * The value lives in a module-level store rather than component state because the list
 * is rendered from two independent hosts — the chat input's Tools popover and the "+"
 * menu's skills submenu — and they must not disagree about which view is on.
 */
const readStoredViewMode = (): ToolsViewMode => {
  if (typeof localStorage === 'undefined') return 'grouped';

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isViewMode(stored) ? stored : 'grouped';
  } catch {
    // A blocked storage must not stop the list from rendering.
    return 'grouped';
  }
};

let currentViewMode: ToolsViewMode = readStoredViewMode();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => currentViewMode;

// Every surface renders this list inside the client, so the server pass only has to
// stay stable through hydration.
const getServerSnapshot = (): ToolsViewMode => 'grouped';

export const useToolsViewMode = () => {
  const viewMode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const updateViewMode = useCallback((mode: ToolsViewMode) => {
    currentViewMode = mode;
    for (const listener of listeners) listener();

    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Persisting is best-effort; the switch still applies for this session.
    }
  }, []);

  return { updateViewMode, viewMode };
};
