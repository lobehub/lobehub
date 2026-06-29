import type { UnknownRecord } from '@lobechat/utils/object';
import { isRecord } from '@lobechat/utils/object';

export const CHAT_INPUT_HISTORY_STORAGE_KEY = 'lobechat:chat-input-history:v1';

export const MAX_INPUT_HISTORY_ITEMS = 50;

export interface ChatInputHistoryEntry {
  createdAt: number;
  json?: UnknownRecord;
  markdown: string;
}

interface AddInputHistoryParams {
  json?: UnknownRecord;
  markdown: string;
}

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

const readAll = (): ChatInputHistoryEntry[] => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(CHAT_INPUT_HISTORY_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isHistoryEntry).slice(0, MAX_INPUT_HISTORY_ITEMS);
  } catch {
    return [];
  }
};

const writeAll = (items: ChatInputHistoryEntry[]): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(CHAT_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
};

export const getInputHistory = (): ChatInputHistoryEntry[] => readAll();

export const addInputHistory = ({ json, markdown }: AddInputHistoryParams): void => {
  const normalizedMarkdown = markdown.trim();
  if (!normalizedMarkdown) return;

  const createdAt = Date.now();
  const nextEntry: ChatInputHistoryEntry = {
    createdAt,
    markdown,
    ...(json ? { json } : {}),
  };

  const dedupedItems = readAll().filter((item) => item.markdown.trim() !== normalizedMarkdown);

  writeAll([nextEntry, ...dedupedItems].slice(0, MAX_INPUT_HISTORY_ITEMS));
};
