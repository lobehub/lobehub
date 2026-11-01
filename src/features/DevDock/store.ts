import { create } from 'zustand';

const STORAGE_KEY = 'LOBE_DEV_DOCK_UI';

export const MIN_PANEL_HEIGHT = 180;

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
    return { ...DEFAULT_UI, ...(JSON.parse(raw) as Partial<DevDockUIState>) };
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
        activePanelId,
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
