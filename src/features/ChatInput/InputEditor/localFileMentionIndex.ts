import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import debug from 'debug';
import Fuse from 'fuse.js';

import { localFileService } from '@/services/electron/localFileService';

const log = debug('chat-input:local-file-mention:index');

const INDEX_REFRESH_INTERVAL = 5000;

interface LocalFileMentionIndex {
  entries: ProjectFileIndexEntry[];
  fuse: Fuse<ProjectFileIndexEntry>;
  indexedAt: number;
  root: string;
}

interface LocalFileMentionIndexCache {
  index?: LocalFileMentionIndex;
  refreshPromise?: Promise<LocalFileMentionIndex>;
}

const cache = new Map<string, LocalFileMentionIndexCache>();

const buildIndex = async (scope: string): Promise<LocalFileMentionIndex> => {
  const startedAt = Date.now();
  const result = await localFileService.getProjectFileIndex({ scope });
  const fuse = new Fuse(result.entries, {
    ignoreLocation: true,
    keys: ['relativePath', 'name', 'path'],
    threshold: 0.35,
  });

  log('Built project file mention index', {
    duration: Date.now() - startedAt,
    entries: result.entries.length,
    root: result.root,
    source: result.source,
  });

  return {
    entries: result.entries,
    fuse,
    indexedAt: Date.now(),
    root: result.root,
  };
};

const refreshIndex = (scope: string, entry: LocalFileMentionIndexCache) => {
  if (entry.refreshPromise) return entry.refreshPromise;

  entry.refreshPromise = buildIndex(scope)
    .then((index) => {
      entry.index = index;
      return index;
    })
    .finally(() => {
      entry.refreshPromise = undefined;
    });

  return entry.refreshPromise;
};

const getCacheEntry = (scope: string) => {
  const existing = cache.get(scope);
  if (existing) return existing;

  const entry: LocalFileMentionIndexCache = {};
  cache.set(scope, entry);
  return entry;
};

export const warmProjectFileMentionIndex = (scope: string | undefined) => {
  if (!scope) return;

  const entry = getCacheEntry(scope);
  if (entry.index || entry.refreshPromise) return;

  void refreshIndex(scope, entry);
};

export const searchProjectFileMentionIndex = async (
  scope: string | undefined,
  query: string,
  limit: number,
): Promise<ProjectFileIndexEntry[]> => {
  if (!scope) return [];

  const entry = getCacheEntry(scope);
  const isStale = !entry.index || Date.now() - entry.index.indexedAt > INDEX_REFRESH_INTERVAL;

  if (!entry.index) {
    await refreshIndex(scope, entry);
  } else if (isStale) {
    void refreshIndex(scope, entry);
  }

  const index = entry.index;
  if (!index) return [];

  return index.fuse.search(query, { limit }).map((result) => result.item);
};
