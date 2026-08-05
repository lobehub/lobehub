import { isRecord, pickString } from '@lobechat/utils/object';
import debug from 'debug';
import { unstable_serialize } from 'swr';

import {
  type CanonicalMessageListContext,
  LEGACY_MESSAGE_CACHE_VERSION,
  MESSAGE_CACHE_VERSION,
  messageKeys,
  type MessageListQueryContext,
  normalizeMessageListQueryContext,
} from '../keys';
import { buildLocalDataKey, localDataCache, type ScopeEntry } from '../localDataCache';

const log = debug('lobe-client:swr-message-migration');

const LEGACY_MESSAGE_LIST_ROOT = 'message:listLegacy';
const legacyMessageListRoots = [messageKeys.list.root, LEGACY_MESSAGE_LIST_ROOT];
const serializedMessageListPrefixes = legacyMessageListRoots.map((root) =>
  unstable_serialize([root]),
);

interface MigrationCandidate {
  source: ScopeEntry;
  target: ScopeEntry;
}

interface MigrateMessageListCacheOptions {
  entries: ScopeEntry[];
  onError?: (error: Error) => void;
  providerVersion: string;
  scope: string;
}

const nullableString = (value: unknown): string | null | undefined =>
  value === null ? null : pickString(value);

const readContext = (value: unknown): MessageListQueryContext | undefined => {
  if (!isRecord(value)) return;

  const context = {
    agentId: nullableString(value.agentId),
    groupId: nullableString(value.groupId),
    threadId: nullableString(value.threadId),
    topicId: nullableString(value.topicId),
    topicShareId: pickString(value.topicShareId),
  };

  if (!context.topicId && !context.topicShareId) return;
  if (!context.agentId && !context.groupId && !context.topicShareId) return;
  return context;
};

/**
 * Recover only personal-conversation coordinates that are encoded consistently
 * in every cached row. Group messages cannot recover the supervisor agent from
 * message authors, and an empty list contains no coordinates, so both remain
 * deliberately unrecoverable instead of being copied to a guessed key.
 */
const deriveContextFromMessages = (state: Record<PropertyKey, unknown>) => {
  if (!Array.isArray(state.data) || state.data.length === 0) return;
  if (!state.data.every(isRecord)) return;

  const rows = state.data;
  if (rows.some((row) => row.groupId !== undefined && row.groupId !== null)) return;
  if (
    !rows.every(
      (row) =>
        Object.hasOwn(row, 'agentId') &&
        Object.hasOwn(row, 'threadId') &&
        Object.hasOwn(row, 'topicId'),
    )
  ) {
    return;
  }

  const agentIds = new Set(rows.map((row) => row.agentId));
  const topicIds = new Set(rows.map((row) => row.topicId));
  const threadValues = new Set(rows.map((row) => row.threadId));

  if (agentIds.size !== 1 || topicIds.size !== 1 || threadValues.size !== 1) return;
  const [agentId] = agentIds;
  const [topicId] = topicIds;
  const [threadId] = threadValues;
  if (typeof agentId !== 'string' || !agentId) return;
  if (typeof topicId !== 'string' || !topicId) return;
  if (threadId !== null && typeof threadId !== 'string') return;

  return normalizeMessageListQueryContext({
    agentId,
    groupId: null,
    threadId,
    topicId,
  });
};

const workspaceSuffixFromScope = (scope: string): string[] => {
  const separatorIndex = scope.lastIndexOf(':');
  if (separatorIndex < 0) return [];
  const workspaceId = scope.slice(separatorIndex + 1);
  return workspaceId && workspaceId !== 'personal' ? [workspaceId] : [];
};

/**
 * SWR may persist data written through `mutate` before a hook mounts. Those
 * states legitimately have no `_k`, so identify an already-canonical v2 row
 * from its serialized version/workspace suffix before attempting legacy
 * recovery. Ambiguous rows must never be destructively treated as legacy.
 */
const isCanonicalSerializedMessageKey = (entry: ScopeEntry, scope: string): boolean => {
  if (
    !serializedMessageListPrefixes[0] ||
    !entry.key.startsWith(serializedMessageListPrefixes[0])
  ) {
    return false;
  }

  const versionSuffix = unstable_serialize([
    MESSAGE_CACHE_VERSION,
    ...workspaceSuffixFromScope(scope),
  ]).slice(1);

  return entry.key.endsWith(versionSuffix);
};

const buildCandidate = (entry: ScopeEntry, scope: string): MigrationCandidate | undefined => {
  if (!isRecord(entry.data)) return;

  const originalKey = entry.data._k;
  let context: CanonicalMessageListContext | undefined;
  let trailingKey: unknown[];

  if (Array.isArray(originalKey)) {
    const root = originalKey[0];
    const isVersionOne =
      root === messageKeys.list.root && originalKey[2] === LEGACY_MESSAGE_CACHE_VERSION;
    const isVersionlessList =
      root === messageKeys.list.root &&
      (originalKey.length === 2 || typeof originalKey[2] === 'string');
    const isLegacyList = root === LEGACY_MESSAGE_LIST_ROOT;
    if (!isVersionOne && !isVersionlessList && !isLegacyList) return;

    const legacyContext = readContext(originalKey[1]);
    if (!legacyContext) return;
    context = normalizeMessageListQueryContext(legacyContext);
    trailingKey = originalKey.slice(isVersionOne ? 3 : 2);
  } else {
    if (!serializedMessageListPrefixes.some((prefix) => entry.key.startsWith(prefix))) return;
    if (isCanonicalSerializedMessageKey(entry, scope)) return;
    context = deriveContextFromMessages(entry.data);
    if (!context) return;
    trailingKey = workspaceSuffixFromScope(scope);
  }

  const canonicalOriginalKey = [...messageKeys.list(context), ...trailingKey];
  const canonicalSerializedKey = unstable_serialize(canonicalOriginalKey);

  // An original-key-less row can already serialize to v2. Never rewrite it.
  if (canonicalSerializedKey === entry.key) return;

  return {
    source: entry,
    target: {
      ...entry,
      data: { ...entry.data, _k: canonicalOriginalKey },
      key: canonicalSerializedKey,
    },
  };
};

const isUnrecoverableLegacyMessageEntry = (entry: ScopeEntry, scope: string): boolean => {
  if (!serializedMessageListPrefixes.some((prefix) => entry.key.startsWith(prefix))) return false;
  if (!isRecord(entry.data)) return true;

  const originalKey = entry.data._k;
  if (Array.isArray(originalKey)) {
    const root = originalKey[0];
    const isVersionOne =
      root === messageKeys.list.root && originalKey[2] === LEGACY_MESSAGE_CACHE_VERSION;
    const isVersionlessList =
      root === messageKeys.list.root &&
      (originalKey.length === 2 || typeof originalKey[2] === 'string');
    const isLegacyList = root === LEGACY_MESSAGE_LIST_ROOT;
    return (isVersionOne || isVersionlessList || isLegacyList) && !readContext(originalKey[1]);
  }

  if (isCanonicalSerializedMessageKey(entry, scope)) return false;
  return !deriveContextFromMessages(entry.data);
};

/**
 * Canonicalize persisted message-list keys before the provider hydrates them.
 * The returned entries are safe to hydrate even when IndexedDB rejects the
 * transaction; the untouched legacy source then remains available for a retry
 * on the next boot.
 */
export const migrateMessageListCache = async ({
  entries,
  onError,
  providerVersion,
  scope,
}: MigrateMessageListCacheOptions): Promise<ScopeEntry[]> => {
  const currentVersionEntries = entries.filter((entry) => entry.version === providerVersion);
  const candidates = currentVersionEntries
    .map((entry) => buildCandidate(entry, scope))
    .filter((candidate): candidate is MigrationCandidate => candidate !== undefined);
  const candidateSources = new Set(candidates.map(({ source }) => source.key));
  const unrecoverable = currentVersionEntries.filter(
    (entry) => !candidateSources.has(entry.key) && isUnrecoverableLegacyMessageEntry(entry, scope),
  );
  const removedKeys = new Set([...candidateSources, ...unrecoverable.map((entry) => entry.key)]);

  const retained = entries.filter((entry) => !removedKeys.has(entry.key));
  const retainedKeys = new Set(
    retained.filter((entry) => entry.version === providerVersion).map((entry) => entry.key),
  );
  const newestByTarget = new Map<string, ScopeEntry>();

  for (const { target } of candidates) {
    if (retainedKeys.has(target.key)) continue;
    const current = newestByTarget.get(target.key);
    if (!current || target.updatedAt > current.updatedAt) newestByTarget.set(target.key, target);
  }

  const migratedEntries = [...newestByTarget.values()];
  const hydratedEntries = [...retained, ...migratedEntries];

  if (removedKeys.size === 0 && migratedEntries.length === 0) return hydratedEntries;

  try {
    await localDataCache.applyBatch({
      deleteKeys: [...removedKeys].map((key) => buildLocalDataKey(scope, key)),
      putEntries: migratedEntries.map((entry) => ({
        ...entry,
        key: buildLocalDataKey(scope, entry.key),
      })),
    });
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    log('Message cache migration will retry after transaction failure: %O', error);
    onError?.(error);
  }

  if (unrecoverable.length > 0) {
    log('Excluded %d unrecoverable legacy message cache rows from hydration', unrecoverable.length);
  }

  return hydratedEntries;
};
