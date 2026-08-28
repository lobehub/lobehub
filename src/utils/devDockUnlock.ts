import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'LOBE_DEV_DOCK_UNLOCKED';
const REQUIRED_CLICKS = 5;
const CLICK_TIMEOUT_MS = 1500;

let memoryUnlocked = false;
const listeners = new Set<() => void>();

export interface DevDockClickSequence {
  count: number;
  lastClickAt: number;
}

export const INITIAL_DEV_DOCK_CLICK_SEQUENCE: DevDockClickSequence = {
  count: 0,
  lastClickAt: 0,
};

const readUnlocked = () => {
  if (typeof localStorage === 'undefined') return memoryUnlocked;

  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return memoryUnlocked;
  }
};

export const setDevDockUnlocked = (unlocked: boolean) => {
  memoryUnlocked = unlocked;

  if (typeof localStorage !== 'undefined') {
    try {
      if (unlocked) localStorage.setItem(STORAGE_KEY, '1');
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The in-memory state still keeps the current session functional when
      // storage is unavailable (for example, a privacy-restricted browser).
    }
  }

  listeners.forEach((listener) => listener());
};

export const toggleDevDockUnlocked = () => {
  const unlocked = !readUnlocked();
  setDevDockUnlocked(unlocked);
  return unlocked;
};

export const advanceDevDockClickSequence = (
  sequence: DevDockClickSequence,
  now: number,
): { completed: boolean; sequence: DevDockClickSequence } => {
  const count = now - sequence.lastClickAt <= CLICK_TIMEOUT_MS ? sequence.count + 1 : 1;

  if (count < REQUIRED_CLICKS) {
    return { completed: false, sequence: { count, lastClickAt: now } };
  }

  return { completed: true, sequence: INITIAL_DEV_DOCK_CLICK_SEQUENCE };
};

// Dev builds always mount — cloud flag / workspace-whitelist gating applies to
// production builds only, so local development never depends on server config.
export const shouldMountDevDock = ({
  canAccess,
  isProduction,
  unlocked,
}: {
  canAccess: boolean;
  isProduction: boolean;
  unlocked: boolean;
}) => (isProduction ? canAccess && unlocked : true);

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', handleStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', handleStorage);
  };
};

export const useDevDockUnlocked = () => useSyncExternalStore(subscribe, readUnlocked, () => false);
