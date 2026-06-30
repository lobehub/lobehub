import type { UnknownRecord } from '@lobechat/utils/object';
import { isRecord } from '@lobechat/utils/object';

export const CHAT_INPUT_HISTORY_STORAGE_KEY = 'lobechat:chat-input-history:v2';

export const MAX_INPUT_HISTORY_ITEMS = 50;

export interface ChatInputHistoryEntry {
  createdAt: number;
  json?: UnknownRecord;
  markdown: string;
}

export interface ChatInputHistoryScope {
  agentId?: string;
  userId?: string;
}

interface AddInputHistoryParams extends ChatInputHistoryScope {
  json?: UnknownRecord;
  markdown: string;
}

const ANONYMOUS_INPUT_HISTORY_SCOPE = 'anonymous';
const GLOBAL_AGENT_INPUT_HISTORY_SCOPE = 'global';
const LEGACY_GLOBAL_INPUT_HISTORY_STORAGE_KEY = 'lobechat:chat-input-history:v1';

/**
 * Example: user A's prompt must not appear when user B opens another agent and presses ArrowUp.
 */
export const getInputHistoryStorageKey = ({
  agentId,
  userId,
}: ChatInputHistoryScope = {}): string =>
  [
    CHAT_INPUT_HISTORY_STORAGE_KEY,
    'user',
    encodeURIComponent(userId || ANONYMOUS_INPUT_HISTORY_SCOPE),
    'agent',
    encodeURIComponent(agentId || GLOBAL_AGENT_INPUT_HISTORY_SCOPE),
  ].join(':');

const isHistoryEntry = (value: unknown): value is ChatInputHistoryEntry => {
  if (!isRecord(value)) return false;

  const { createdAt, json, markdown } = value;

  return (
    typeof createdAt === 'number' &&
    typeof markdown === 'string' &&
    markdown.trim().length > 0 &&
    (json === undefined || isRecord(json))
  );
};

const removeLegacyGlobalHistory = () => {
  try {
    window.localStorage.removeItem(LEGACY_GLOBAL_INPUT_HISTORY_STORAGE_KEY);
  } catch {
    // Ignore storage failures; scoped history should still work when possible.
  }
};

const readAll = (scope?: ChatInputHistoryScope): ChatInputHistoryEntry[] => {
  if (typeof window === 'undefined') return [];

  removeLegacyGlobalHistory();

  try {
    const raw = window.localStorage.getItem(getInputHistoryStorageKey(scope));
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isHistoryEntry).slice(0, MAX_INPUT_HISTORY_ITEMS);
  } catch {
    return [];
  }
};

const writeAll = (items: ChatInputHistoryEntry[], scope?: ChatInputHistoryScope): boolean => {
  if (typeof window === 'undefined') return false;

  removeLegacyGlobalHistory();

  try {
    window.localStorage.setItem(getInputHistoryStorageKey(scope), JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
};

export const getInputHistory = (scope?: ChatInputHistoryScope): ChatInputHistoryEntry[] =>
  readAll(scope);

export const addInputHistory = ({
  agentId,
  json,
  markdown,
  userId,
}: AddInputHistoryParams): void => {
  const normalizedMarkdown = markdown.trim();
  if (!normalizedMarkdown) return;

  const scope = { agentId, userId };
  const createdAt = Date.now();
  const nextEntry: ChatInputHistoryEntry = {
    createdAt,
    markdown,
    ...(json ? { json } : {}),
  };

  const dedupedItems = readAll(scope).filter((item) => item.markdown.trim() !== normalizedMarkdown);

  writeAll([nextEntry, ...dedupedItems].slice(0, MAX_INPUT_HISTORY_ITEMS), scope);
};
