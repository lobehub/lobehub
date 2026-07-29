import { useSyncExternalStore } from 'react';

export const CHAT_INPUT_DRAFTS_STORAGE_KEY = 'lobechat:chat-input-drafts:v1';

const MAX_DRAFTS = 50;

export interface ChatInputDraftEntry {
  json: Record<string, unknown>;
  updatedAt: number;
}

type DraftMap = Record<string, ChatInputDraftEntry>;

const isDraftEntry = (value: unknown): value is ChatInputDraftEntry =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as ChatInputDraftEntry).updatedAt === 'number' &&
  !!(value as ChatInputDraftEntry).json &&
  typeof (value as ChatInputDraftEntry).json === 'object';

const readAll = (): DraftMap => {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(CHAT_INPUT_DRAFTS_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const result: DraftMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isDraftEntry(value)) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
};

const writeAll = (map: DraftMap): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(CHAT_INPUT_DRAFTS_STORAGE_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
};

// --- Reactive draft-key registry -------------------------------------------
// localStorage isn't reactive, but the topic list needs to react when a draft
// appears or clears so it can show a "[draft]" hint next to the topic title. We
// mirror the *set of keys that currently hold a draft* into an in-memory
// snapshot and notify subscribers whenever that set changes — not on every
// keystroke-level save, so a topic that already shows the hint doesn't re-render
// while the user keeps typing.

const draftKeysListeners = new Set<() => void>();
let draftKeysSnapshot: ReadonlySet<string> = new Set<string>();
let draftKeysInitialized = false;

const ensureDraftKeysInit = () => {
  if (draftKeysInitialized) return;
  draftKeysInitialized = true;
  draftKeysSnapshot = new Set(Object.keys(readAll()));
};

const syncDraftKeys = (map: DraftMap) => {
  ensureDraftKeysInit();
  const next = Object.keys(map);
  if (next.length === draftKeysSnapshot.size && next.every((key) => draftKeysSnapshot.has(key)))
    return;

  draftKeysSnapshot = new Set(next);
  draftKeysListeners.forEach((listener) => listener());
};

const subscribeDraftKeys = (listener: () => void) => {
  draftKeysListeners.add(listener);
  return () => {
    draftKeysListeners.delete(listener);
  };
};

/**
 * Reactively report whether a draft currently exists for the given draft key.
 * Returns false for an empty key. Used by the topic list to show a "[draft]"
 * hint on topics that hold unsent input.
 */
export const useHasDraft = (key: string | undefined): boolean =>
  useSyncExternalStore(
    subscribeDraftKeys,
    () => {
      if (!key) return false;
      ensureDraftKeysInit();
      return draftKeysSnapshot.has(key);
    },
    () => false,
  );

export const getDraft = (key: string): Record<string, unknown> | undefined => {
  if (!key) return undefined;
  return readAll()[key]?.json;
};

export const saveDraft = (key: string, json: Record<string, unknown>): void => {
  if (!key) return;

  const map = readAll();
  map[key] = { json, updatedAt: Date.now() };

  const keys = Object.keys(map);
  if (keys.length > MAX_DRAFTS) {
    keys
      .sort((a, b) => map[a].updatedAt - map[b].updatedAt)
      .slice(0, keys.length - MAX_DRAFTS)
      .forEach((staleKey) => {
        delete map[staleKey];
      });
  }

  writeAll(map);
  syncDraftKeys(map);
};

export const removeDraft = (key: string): void => {
  if (!key) return;

  const map = readAll();
  if (!(key in map)) return;

  delete map[key];
  writeAll(map);
  syncDraftKeys(map);
};
