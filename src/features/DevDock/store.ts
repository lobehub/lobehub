import { create } from 'zustand';

const STORAGE_KEY = 'LOBE_DEV_DOCK_UI';

export const MIN_PANEL_HEIGHT = 180;

/**
 * Panels that must never be restored on boot.
 *
 * The Local Database panel reads every entry of the local database when it mounts.
 * When that read hangs the restored panel freezes the app before the user can close
 * it, and a force quit only brings it back. The panel stays openable — it just never
 * becomes the panel the next launch restores.
 */
const UNRESTORABLE_PANEL_IDS = new Set(['local-database']);

export const toPersistedActivePanelId = (id: string | null | undefined): string | null => {
  if (!id) return null;

  return UNRESTORABLE_PANEL_IDS.has(id) ? null : id;
};

interface DevDockUIState {
  activePanelId: string | null;
  expanded: boolean;
  maximized: boolean;
  mesurer: boolean;
  panelHeight: number;
  pinOverrides: Record<string, boolean>;
  reactScan: boolean;
  scrollDebug: boolean;
}

const bootReactScan = typeof __REACT_SCAN__ !== 'undefined' && __REACT_SCAN__;

const DEFAULT_UI: DevDockUIState = {
  activePanelId: null,
  expanded: true,
  maximized: false,
  mesurer: false,
  panelHeight: 360,
  pinOverrides: {},
  reactScan: bootReactScan,
  scrollDebug: false,
};

const readPersisted = (): DevDockUIState => {
  if (typeof localStorage === 'undefined') return DEFAULT_UI;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_UI;
    const persisted = { ...DEFAULT_UI, ...(JSON.parse(raw) as Partial<DevDockUIState>) };

    return { ...persisted, activePanelId: toPersistedActivePanelId(persisted.activePanelId) };
  } catch {
    return DEFAULT_UI;
  }
};

export interface DevDockStore extends DevDockUIState {
  setExpanded: (expanded: boolean) => void;
  setMaximized: (maximized: boolean) => void;
  setMesurer: (mesurer: boolean) => void;
  setPanelHeight: (panelHeight: number) => void;
  setPinned: (id: string, pinned: boolean) => void;
  setReactScan: (reactScan: boolean) => void;
  setScrollDebug: (scrollDebug: boolean) => void;
  togglePanel: (id: string) => void;
}

export const useDevDockStore = create<DevDockStore>((set, get) => {
  const update = (patch: Partial<DevDockUIState>) => {
    set(patch);
    if (typeof localStorage === 'undefined') return;
    const {
      activePanelId,
      expanded,
      maximized,
      mesurer,
      panelHeight,
      pinOverrides,
      reactScan,
      scrollDebug,
    } = get();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activePanelId: toPersistedActivePanelId(activePanelId),
        expanded,
        maximized,
        mesurer,
        panelHeight,
        pinOverrides,
        reactScan,
        scrollDebug,
      }),
    );
  };

  return {
    ...readPersisted(),
    setExpanded: (expanded) => update({ expanded }),
    setMaximized: (maximized) => update({ maximized }),
    setMesurer: (mesurer) => update({ mesurer }),
    setPanelHeight: (panelHeight) =>
      update({ panelHeight: Math.max(MIN_PANEL_HEIGHT, panelHeight) }),
    setPinned: (id, pinned) => update({ pinOverrides: { ...get().pinOverrides, [id]: pinned } }),
    setReactScan: (reactScan) => update({ reactScan }),
    setScrollDebug: (scrollDebug) => update({ scrollDebug }),
    togglePanel: (id) => update({ activePanelId: get().activePanelId === id ? null : id }),
  };
});
