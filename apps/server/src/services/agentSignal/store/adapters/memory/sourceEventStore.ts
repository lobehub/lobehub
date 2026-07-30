import type { AgentSignalSourceEventStore, AgentSignalSourceEventWindowPayload } from '../../types';
import { ExpiringMap } from './expiringMap';

const dedupeEntries = new ExpiringMap<boolean>();
const scopeLocks = new ExpiringMap<boolean>();
const windows = new ExpiringMap<AgentSignalSourceEventWindowPayload>();

const getTtlMs = (ttlSeconds: number) => ttlSeconds * 1000;

const reserve = (entries: ExpiringMap<boolean>, key: string, ttlSeconds: number) => {
  if (entries.get(key)) return false;

  entries.set(key, true, getTtlMs(ttlSeconds));
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
    const data = windows.get(scopeKey);
    return data ? { ...data } : undefined;
  },
  releaseScopeLock: async (scopeKey) => {
    scopeLocks.delete(scopeKey);
  },
  tryDedupe: async (eventId, ttlSeconds) => reserve(dedupeEntries, eventId, ttlSeconds),
  writeWindow: async (scopeKey, data, ttlSeconds) => {
    windows.set(scopeKey, { ...data }, getTtlMs(ttlSeconds));
  },
};
