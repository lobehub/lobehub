export const SCROLL_SNAPSHOT_KEY_PREFIX = 'LOBEHUB_SCROLL';
export const SCROLL_SNAPSHOT_MAX_ENTRIES = 500;
export const SCROLL_SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface ScrollSnapshot {
  atBottom: boolean;
  offset: number;
  savedAt: number;
}

const buildStorageKey = (contextKey: string) => `${SCROLL_SNAPSHOT_KEY_PREFIX}:${contextKey}`;

const getStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

const isValidSnapshot = (value: unknown): value is ScrollSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.offset === 'number' &&
    Number.isFinite(v.offset) &&
    typeof v.atBottom === 'boolean' &&
    typeof v.savedAt === 'number' &&
    Number.isFinite(v.savedAt)
  );
};

const collectPrefixedKeys = (storage: Storage): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(`${SCROLL_SNAPSHOT_KEY_PREFIX}:`)) keys.push(key);
  }
  return keys;
};

export interface PruneResult {
  evictedExpired: number;
  evictedOverflow: number;
  remaining: number;
}

export const pruneScrollSnapshots = (storage: Storage | null = getStorage()): PruneResult => {
  const result: PruneResult = { evictedExpired: 0, evictedOverflow: 0, remaining: 0 };
  if (!storage) return result;

  const now = Date.now();
  const valid: { key: string; savedAt: number }[] = [];

  for (const key of collectPrefixedKeys(storage)) {
    try {
      const raw = storage.getItem(key);
      if (!raw) {
        storage.removeItem(key);
        continue;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!isValidSnapshot(parsed)) {
        storage.removeItem(key);
        continue;
      }
      if (now - parsed.savedAt > SCROLL_SNAPSHOT_MAX_AGE_MS) {
        storage.removeItem(key);
        result.evictedExpired += 1;
        continue;
      }
      valid.push({ key, savedAt: parsed.savedAt });
    } catch {
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }

  if (valid.length > SCROLL_SNAPSHOT_MAX_ENTRIES) {
    valid.sort((a, b) => a.savedAt - b.savedAt);
    const overflow = valid.length - SCROLL_SNAPSHOT_MAX_ENTRIES;
    for (let i = 0; i < overflow; i++) {
      try {
        storage.removeItem(valid[i].key);
        result.evictedOverflow += 1;
      } catch {
        // ignore
      }
    }
  }

  result.remaining = valid.length - result.evictedOverflow;
  return result;
};

export const loadScrollSnapshot = (contextKey: string): ScrollSnapshot | null => {
  const storage = getStorage();
  if (!storage) return null;

  const storageKey = buildStorageKey(contextKey);

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!isValidSnapshot(parsed)) {
      storage.removeItem(storageKey);
      return null;
    }

    if (Date.now() - parsed.savedAt > SCROLL_SNAPSHOT_MAX_AGE_MS) {
      storage.removeItem(storageKey);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

export const saveScrollSnapshot = (contextKey: string, snapshot: ScrollSnapshot): void => {
  const storage = getStorage();
  if (!storage) return;

  const storageKey = buildStorageKey(contextKey);
  const payload = JSON.stringify(snapshot);

  try {
    storage.setItem(storageKey, payload);
  } catch (error) {
    // Likely QuotaExceededError or storage disabled — try to free space and retry once.
    try {
      pruneScrollSnapshots(storage);
      storage.setItem(storageKey, payload);
    } catch {
      console.error('[scrollSnapshotStore] failed to persist scroll snapshot', error);
    }
  }
};

const NEW_KEY_SUFFIX = '_new';

/**
 * Detects "draft promoted to a real id" — `messageMapKey()` returns a `*_new`
 * key while a topic/thread is still optimistic, and switches to the
 * id-bearing key once `onTopicCreated` / `onThreadCreated` lands. The new key
 * is the previous one with `_new` replaced by `_<id>`, so the logical
 * conversation is unchanged. Callers should preserve scroll position across
 * this transition rather than treating it as a topic switch.
 */
export const isDraftPromotionKey = (prevKey: string, nextKey: string): boolean => {
  if (prevKey === nextKey) return false;
  if (!prevKey.endsWith(NEW_KEY_SUFFIX)) return false;
  // Keep the trailing underscore so we don't match unrelated keys whose base
  // happens to share a prefix (e.g. `main_agt_xxx_new` vs `main_agt_xxxx_*`).
  const baseWithSeparator = prevKey.slice(0, -(NEW_KEY_SUFFIX.length - 1));
  return nextKey.startsWith(baseWithSeparator);
};

/**
 * Move a snapshot from one context key to another, dropping the old entry.
 * Used when a draft conversation key is promoted to its real id (see
 * `isDraftPromotionKey`).
 */
export const migrateScrollSnapshot = (oldContextKey: string, newContextKey: string): void => {
  if (oldContextKey === newContextKey) return;
  const storage = getStorage();
  if (!storage) return;

  const oldStorageKey = buildStorageKey(oldContextKey);
  const newStorageKey = buildStorageKey(newContextKey);

  let raw: string | null;
  try {
    raw = storage.getItem(oldStorageKey);
  } catch (error) {
    console.error('[scrollSnapshotStore] failed to read snapshot during migration', error);
    return;
  }
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt entry — drop it rather than carry it forward to the new key.
    try {
      storage.removeItem(oldStorageKey);
    } catch {
      // ignore
    }
    return;
  }

  if (!isValidSnapshot(parsed)) {
    try {
      storage.removeItem(oldStorageKey);
    } catch {
      // ignore
    }
    return;
  }

  try {
    storage.setItem(newStorageKey, raw);
    storage.removeItem(oldStorageKey);
  } catch (error) {
    console.error('[scrollSnapshotStore] failed to write migrated snapshot', error);
  }
};
