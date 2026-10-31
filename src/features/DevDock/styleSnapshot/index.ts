import {
  captureStyles,
  diffStyleSnapshots,
  type PackedSnapshot,
  packSnapshot,
  type StyleSnapshotDiff,
  unpackSnapshot,
} from './snapshot';

const STORAGE_PREFIX = 'lobe-style-snapshot:';

interface StoredSnapshot {
  selector: string;
  snapshot: PackedSnapshot;
  viewport: string;
}

const viewport = () => `${window.innerWidth}x${window.innerHeight}`;

export interface StyleSnapshotApi {
  capture: (name: string, selector?: string) => number;
  clear: () => void;
  compare: (name: string, selector?: string) => StyleSnapshotDiff[];
}

declare global {
  interface Window {
    __lobeStyleSnapshot?: StyleSnapshotApi;
  }
}

const findRoot = (selector: string) => {
  const root = document.querySelector(selector);
  if (!root) throw new Error(`[styleSnapshot] no element matches ${selector}`);
  return root;
};

// Storage is read on use: a privacy-restricted browser throws on access, which
// at install time would take the whole DevDock chunk down with it.
export const createStyleSnapshotApi = (
  getStorage: () => Storage = () => localStorage,
): StyleSnapshotApi => ({
  capture: (name, selector = 'body') => {
    const entries = captureStyles(findRoot(selector));
    getStorage().setItem(
      STORAGE_PREFIX + name,
      JSON.stringify({
        selector,
        snapshot: packSnapshot(entries),
        viewport: viewport(),
      } satisfies StoredSnapshot),
    );
    return entries.length;
  },
  clear: () => {
    const storage = getStorage();
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (key?.startsWith(STORAGE_PREFIX)) storage.removeItem(key);
    }
  },
  compare: (name, selector) => {
    const raw = getStorage().getItem(STORAGE_PREFIX + name);
    if (!raw) throw new Error(`[styleSnapshot] no snapshot named ${name}`);
    const saved = JSON.parse(raw) as StoredSnapshot;
    if (saved.viewport !== viewport())
      throw new Error(
        `[styleSnapshot] viewport changed from ${saved.viewport} to ${viewport()}; resize back before comparing`,
      );
    return diffStyleSnapshots(
      unpackSnapshot(saved.snapshot),
      captureStyles(findRoot(selector ?? saved.selector)),
    );
  },
});

export const installStyleSnapshot = () => {
  window.__lobeStyleSnapshot = createStyleSnapshotApi();
};
