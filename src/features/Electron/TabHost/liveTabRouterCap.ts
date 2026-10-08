import { create } from 'zustand';

const STORAGE_KEY = 'LOBE_LIVE_TAB_ROUTER_CAP';

export const DEFAULT_LIVE_TAB_ROUTER_CAP = 10;

const normalizeCap = (value: unknown): number | null => {
  const cap = Number(value);
  return Number.isInteger(cap) && cap > 0 ? cap : null;
};

const readPersisted = (): number => {
  try {
    return normalizeCap(localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_LIVE_TAB_ROUTER_CAP;
  } catch {
    return DEFAULT_LIVE_TAB_ROUTER_CAP;
  }
};

interface LiveTabRouterCapStore {
  cap: number;
  setCap: (cap: number) => void;
}

export const useLiveTabRouterCap = create<LiveTabRouterCapStore>((set) => ({
  cap: readPersisted(),
  setCap: (value) => {
    const cap = normalizeCap(value);
    if (cap === null) return;
    set({ cap });
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, String(cap));
  },
}));
