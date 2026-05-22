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
};

export const removeDraft = (key: string): void => {
  if (!key) return;

  const map = readAll();
  if (!(key in map)) return;

  delete map[key];
  writeAll(map);
};
