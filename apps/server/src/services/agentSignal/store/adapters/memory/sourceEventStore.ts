import type { AgentSignalSourceEventStore, AgentSignalSourceEventWindowPayload } from '../../types';

interface ExpiringValue<T> {
  expiresAt: number;
  value: T;
}

const dedupeEntries = new Map<string, number>();
const scopeLocks = new Map<string, number>();
const windows = new Map<string, ExpiringValue<AgentSignalSourceEventWindowPayload>>();

const getExpiresAt = (ttlSeconds: number) => Date.now() + ttlSeconds * 1000;

const reserve = (entries: Map<string, number>, key: string, ttlSeconds: number) => {
  const now = Date.now();
  const expiresAt = entries.get(key);
  if (expiresAt && expiresAt > now) return false;

  entries.set(key, getExpiresAt(ttlSeconds));
  return true;
};

/**
 * Process-local source-event state for non-durable Agent Signal execution.
 *
 * Local workflow mode deliberately avoids Redis and QStash. Keeping this store
 * at module scope preserves dedupe, scope locks, and source windows for the
 * lifetime of the server process without implying cross-process durability.
 */
export const inMemorySourceEventStore: AgentSignalSourceEventStore = {
  acquireScopeLock: async (scopeKey, ttlSeconds) => reserve(scopeLocks, scopeKey, ttlSeconds),
  readWindow: async (scopeKey) => {
    const entry = windows.get(scopeKey);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      windows.delete(scopeKey);
      return undefined;
    }

    return { ...entry.value };
  },
  releaseScopeLock: async (scopeKey) => {
    scopeLocks.delete(scopeKey);
  },
  tryDedupe: async (eventId, ttlSeconds) => reserve(dedupeEntries, eventId, ttlSeconds),
  writeWindow: async (scopeKey, data, ttlSeconds) => {
    windows.set(scopeKey, {
      expiresAt: getExpiresAt(ttlSeconds),
      value: { ...data },
    });
  },
};
