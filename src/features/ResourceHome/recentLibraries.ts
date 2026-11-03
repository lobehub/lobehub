import { useSyncExternalStore } from 'react';

/**
 * Local record of when each library was last opened, for the Docs sidebar's
 * "Recent libraries" section. Device-local on purpose: it orders a shortcut
 * list and carries no meaning worth a server round-trip. Library ids are
 * globally unique and the section intersects them with the active scope's
 * list, so one map serves every workspace.
 */
const STORAGE_KEY = 'LOBE_DOCS_RECENT_LIBRARIES';
const CHANGE_EVENT = 'lobe-docs-recent-libraries';
/** Visits kept; older entries fall off so the map stays bounded. */
const MAX_ENTRIES = 50;

export const RECENT_LIBRARY_LIMIT = 5;

export type LibraryVisits = Record<string, number>;

const EMPTY_VISITS: LibraryVisits = {};

let cachedRaw: string | null = null;
let cachedVisits: LibraryVisits = EMPTY_VISITS;

const readVisits = (): LibraryVisits => {
  if (typeof window === 'undefined') return EMPTY_VISITS;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY_VISITS;
  }
  if (raw === cachedRaw) return cachedVisits;

  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    cachedVisits = parsed && typeof parsed === 'object' ? (parsed as LibraryVisits) : EMPTY_VISITS;
  } catch {
    cachedVisits = EMPTY_VISITS;
  }
  return cachedVisits;
};

export const recordLibraryVisit = (libraryId: string, now: number = Date.now()): void => {
  if (typeof window === 'undefined' || !libraryId) return;

  const entries = Object.entries({ ...readVisits(), [libraryId]: now })
    .sort(([, a], [, b]) => b - a)
    .slice(0, MAX_ENTRIES);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage full or blocked: the section falls back to update order.
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

const subscribe = (onChange: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
};

export const useLibraryVisits = (): LibraryVisits =>
  useSyncExternalStore(subscribe, readVisits, () => EMPTY_VISITS);

const timeOf = (value: Date | string | number | undefined): number =>
  value === undefined ? 0 : new Date(value).getTime() || 0;

/**
 * The libraries the section lists: most recently opened first; libraries never
 * opened on this device follow by last update, so a fresh device still shows a
 * useful shortcut list.
 */
export const pickRecentLibraries = <T extends { id: string; updatedAt?: Date | string }>(
  libraries: T[],
  visits: LibraryVisits,
  limit: number = RECENT_LIBRARY_LIMIT,
): T[] =>
  [...libraries]
    .sort((a, b) => {
      const visitDiff = (visits[b.id] ?? 0) - (visits[a.id] ?? 0);
      return visitDiff !== 0 ? visitDiff : timeOf(b.updatedAt) - timeOf(a.updatedAt);
    })
    .slice(0, limit);
