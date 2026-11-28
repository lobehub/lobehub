import type { ModelReasoning } from '@lobechat/types';

import { localDatabase } from '@/libs/localDatabase';
import { cacheScope } from '@/libs/replica';
import { messageService } from '@/services/message';

const COLLECTION = 'message-reasoning';
const MAX_CACHED_ENTRIES = 500;
const PRUNE_EVERY_N_WRITES = 50;

interface StoredReasoningRecord {
  reasoning: ModelReasoning;
  savedAt: number;
}

const memoryCache = new Map<string, ModelReasoning>();
const inflight = new Map<string, Promise<ModelReasoning | undefined>>();
let writesSincePrune = 0;

const scopedKey = (scope: string, messageId: string): string => `${scope}:${messageId}`;

const setMemoryEntry = (key: string, value: ModelReasoning): void => {
  // Refresh insertion order and bound L1 size to prevent unbounded tab/Electron memory growth.
  if (memoryCache.has(key)) memoryCache.delete(key);
  memoryCache.set(key, value);
  while (memoryCache.size > MAX_CACHED_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
};

const toCacheableReasoning = (reasoning: ModelReasoning): ModelReasoning | undefined => {
  if (!reasoning.content?.trim()) return undefined;

  return {
    content: reasoning.content,
    ...(reasoning.duration !== undefined && { duration: reasoning.duration }),
    ...(reasoning.isMultimodal !== undefined && { isMultimodal: reasoning.isMultimodal }),
  };
};

const pruneScopeIfNeeded = async (scope: string): Promise<void> => {
  writesSincePrune += 1;
  if (writesSincePrune < PRUNE_EVERY_N_WRITES) return;
  writesSincePrune = 0;

  const prefix = `${scope}:`;
  const entries = await localDatabase.entriesByPrefix<StoredReasoningRecord>(COLLECTION, prefix);
  if (entries.length <= MAX_CACHED_ENTRIES) return;

  const sorted = [...entries].sort((a, b) => (a.value?.savedAt ?? 0) - (b.value?.savedAt ?? 0));
  const excess = sorted.slice(0, entries.length - MAX_CACHED_ENTRIES);
  await localDatabase.batch(
    excess.map((entry) => ({
      collection: COLLECTION,
      key: entry.key,
      type: 'delete' as const,
    })),
  );
};

/** Synchronous L1 lookup so re-expanding an already-seen card has zero flash. */
export const getCachedReasoningSync = (messageId: string): ModelReasoning | undefined => {
  const scope = cacheScope.get();
  return memoryCache.get(scopedKey(scope, messageId));
};

/** L1 memory → L2 localDatabase (IndexedDB on web, SQLite in Electron). */
export const getCachedReasoning = async (
  messageId: string,
): Promise<ModelReasoning | undefined> => {
  const scope = cacheScope.get();
  const key = scopedKey(scope, messageId);

  const hit = memoryCache.get(key);
  if (hit) return hit;

  if (!cacheScope.canHydrate?.()) return undefined;

  try {
    const stored = await localDatabase.get<StoredReasoningRecord>(COLLECTION, key);
    if (cacheScope.get() !== scope) return undefined;
    if (stored?.reasoning?.content?.trim()) {
      setMemoryEntry(key, stored.reasoning);
      return stored.reasoning;
    }
  } catch {
    // Storage failures degrade gracefully to a network fetch.
  }

  return undefined;
};

/**
 * Persist an immutable reasoning payload to L1 memory and L2 localDatabase.
 * Called both after an on-demand `getReasonings` fetch and when a live stream
 * finishes, so a page reload re-opens the card with zero network requests.
 */
export const setCachedReasoning = async (
  messageId: string,
  reasoning: ModelReasoning,
): Promise<void> => {
  const normalized = toCacheableReasoning(reasoning);
  if (!normalized) return;

  const scope = cacheScope.get();
  const key = scopedKey(scope, messageId);
  setMemoryEntry(key, normalized);

  if (!cacheScope.canPersist()) return;

  try {
    await localDatabase.set(COLLECTION, key, {
      reasoning: normalized,
      savedAt: Date.now(),
    } satisfies StoredReasoningRecord);
    await pruneScopeIfNeeded(scope);
  } catch {
    // Best-effort persistence: L1 memory still serves the current session.
  }
};

/**
 * Resolve the full reasoning for one message:
 * L1 memory → L2 localDatabase (IndexedDB / SQLite) → `message.getReasonings`.
 * Concurrent callers for the same `(scope, messageId)` share one in-flight request.
 */
export const loadMessageReasoning = async (
  messageId: string,
): Promise<ModelReasoning | undefined> => {
  const scope = cacheScope.get();
  const key = scopedKey(scope, messageId);

  const l1 = memoryCache.get(key);
  if (l1) return l1;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<ModelReasoning | undefined> => {
    const l2 = await getCachedReasoning(messageId);
    if (l2) return l2;

    const fetched = await messageService.getReasonings([messageId]);
    if (cacheScope.get() !== scope) return undefined;
    const reasoning = fetched[messageId];
    if (reasoning) {
      await setCachedReasoning(messageId, reasoning);
      if (cacheScope.get() !== scope) return undefined;
      return memoryCache.get(key) ?? reasoning;
    }

    return undefined;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
};

/** Reset in-memory state between unit tests. */
export const resetReasoningCacheForTests = (): void => {
  memoryCache.clear();
  inflight.clear();
  writesSincePrune = 0;
};
