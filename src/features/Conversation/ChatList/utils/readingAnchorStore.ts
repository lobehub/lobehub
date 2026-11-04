export const READING_ANCHOR_KEY_PREFIX = 'LOBEHUB_READING_ANCHOR';
export const READING_ANCHOR_MAX_ENTRIES = 200;
/**
 * A reading anchor lets a reader come back to a long transcript (a shared
 * topic) days later and continue where they stopped, so it outlives the
 * 5-minute topic-switch scroll snapshot by design.
 */
export const READING_ANCHOR_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Where the reader stopped, as a message rather than a pixel offset: a paged
 * transcript reopens with only its first rows loaded, so an offset from the top
 * would land on whatever the first page happens to measure.
 */
export interface ReadingAnchor {
  /** Row id of the message at the top of the viewport. */
  messageId: string;
  /** Pixels the viewport top sits below that row's top edge. */
  offset: number;
  savedAt: number;
}

const buildStorageKey = (key: string) => `${READING_ANCHOR_KEY_PREFIX}:${key}`;

const getStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

const isValidAnchor = (value: unknown): value is ReadingAnchor => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.messageId === 'string' &&
    v.messageId.length > 0 &&
    typeof v.offset === 'number' &&
    Number.isFinite(v.offset) &&
    typeof v.savedAt === 'number' &&
    Number.isFinite(v.savedAt)
  );
};

const readAnchor = (storage: Storage, storageKey: string): ReadingAnchor | null => {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isValidAnchor(parsed) && Date.now() - parsed.savedAt <= READING_ANCHOR_MAX_AGE_MS)
      return parsed;
  } catch {
    // fall through to removal
  }
  try {
    storage.removeItem(storageKey);
  } catch {
    // ignore
  }
  return null;
};

/** Drops expired or corrupt anchors, then the oldest ones above the cap. */
export const pruneReadingAnchors = (storage: Storage | null = getStorage()) => {
  if (!storage) return;

  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(`${READING_ANCHOR_KEY_PREFIX}:`)) keys.push(key);
  }

  const valid: { key: string; savedAt: number }[] = [];
  for (const key of keys) {
    const anchor = readAnchor(storage, key);
    if (anchor) valid.push({ key, savedAt: anchor.savedAt });
  }

  if (valid.length <= READING_ANCHOR_MAX_ENTRIES) return;
  valid.sort((a, b) => a.savedAt - b.savedAt);
  for (const { key } of valid.slice(0, valid.length - READING_ANCHOR_MAX_ENTRIES)) {
    try {
      storage.removeItem(key);
    } catch {
      // ignore
    }
  }
};

export const loadReadingAnchor = (key: string): ReadingAnchor | null => {
  const storage = getStorage();
  return storage ? readAnchor(storage, buildStorageKey(key)) : null;
};

export const saveReadingAnchor = (key: string, anchor: ReadingAnchor): void => {
  const storage = getStorage();
  if (!storage) return;

  const storageKey = buildStorageKey(key);
  const payload = JSON.stringify(anchor);
  try {
    storage.setItem(storageKey, payload);
  } catch (error) {
    // Likely QuotaExceededError — free space and retry once.
    try {
      pruneReadingAnchors(storage);
      storage.setItem(storageKey, payload);
    } catch {
      console.error('[readingAnchorStore] failed to persist reading anchor', error);
    }
  }
};

export const clearReadingAnchor = (key: string): void => {
  try {
    getStorage()?.removeItem(buildStorageKey(key));
  } catch {
    // ignore
  }
};
