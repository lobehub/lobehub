/**
 * Persisted shapes of the Files tab replicas (project tree / git overlay).
 *
 * A project index is a flat list of every file in a repo, and each entry
 * repeats what the root and its own relative path already say (`path`,
 * `name`). Stored verbatim a large monorepo is megabytes per directory, so
 * these codecs store the entries as compact tuples, keep only what the first
 * paint can show when a tree is past the cap, and refuse to persist anything
 * that would still be too large — the network refresh that follows hydration
 * is what makes the tree whole again.
 */
import type {
  GitWorkingTreeFiles,
  ProjectFileIndexEntry,
  ProjectFileIndexResult,
} from '@lobechat/electron-client-ipc';

import {
  REPLICA_INDEX_KEY,
  type ReplicaRow,
  type ReplicaRowKey,
  type ReplicaStorage,
} from '@/libs/replica';

/**
 * Entries beyond this many are not persisted. The default first paint expands
 * the project root only, so the shallowest entries are the ones worth keeping.
 */
export const PROJECT_INDEX_PERSIST_MAX_ENTRIES = 20_000;

/** A dirty-file overlay this large is not worth a stale first paint. */
export const GIT_WORKING_TREE_PERSIST_MAX_PATHS = 5000;

/**
 * Directories whose tree / overlay stay persisted (`persist.maxEntries`); the
 * least recently used are evicted, so storage holds the recent projects a user
 * is likely to reopen, not every directory they ever looked at.
 */
export const PROJECT_INDEX_PERSIST_MAX_ROWS = 10;
export const GIT_WORKING_TREE_PERSIST_MAX_ROWS = 20;

const ENCODED_PROJECT_INDEX = 'projectIndex@1';

const FLAG_DIRECTORY = 1;
const FLAG_GIT_IGNORED = 2;
const FLAG_COLLAPSED = 4;

/**
 * `[relativePath, flags, path?, name?]` — `path` and `name` are only present
 * when they differ from what the root and relative path derive.
 */
type EncodedEntry = [string, number] | [string, number, string | null, string?];

interface EncodedProjectIndex {
  __codec: typeof ENCODED_PROJECT_INDEX;
  /** Entries past the persist cap were dropped from this row. */
  capped?: boolean;
  entries: EncodedEntry[];
  indexedAt: string;
  root: string;
  source: ProjectFileIndexResult['source'];
  truncated?: boolean;
}

const trimTrailingSlash = (value: string) => (value.endsWith('/') ? value.slice(0, -1) : value);

const deriveName = (relativePath: string) => {
  const cleaned = trimTrailingSlash(relativePath);
  return cleaned.slice(cleaned.lastIndexOf('/') + 1);
};

/** The absolute path a host would produce for `relativePath` under `root`. */
const derivePath = (root: string, relativePath: string) => {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const relative = trimTrailingSlash(relativePath).split('/').join(separator);
  if (!root) return relative;
  return root.endsWith(separator) ? `${root}${relative}` : `${root}${separator}${relative}`;
};

const depthOf = (relativePath: string) => trimTrailingSlash(relativePath).split('/').length;

const encodeEntry = (root: string, entry: ProjectFileIndexEntry): EncodedEntry => {
  const flags =
    (entry.isDirectory ? FLAG_DIRECTORY : 0) |
    (entry.gitIgnored ? FLAG_GIT_IGNORED : 0) |
    (entry.collapsed ? FLAG_COLLAPSED : 0);
  const path = entry.path === derivePath(root, entry.relativePath) ? null : entry.path;
  const name = entry.name === deriveName(entry.relativePath) ? undefined : entry.name;

  if (name !== undefined) return [entry.relativePath, flags, path, name];
  if (path !== null) return [entry.relativePath, flags, path];
  return [entry.relativePath, flags];
};

const decodeEntry = (root: string, encoded: EncodedEntry): ProjectFileIndexEntry => {
  const [relativePath, flags, path, name] = encoded;
  return {
    ...(flags & FLAG_COLLAPSED ? { collapsed: true } : {}),
    ...(flags & FLAG_GIT_IGNORED ? { gitIgnored: true } : {}),
    isDirectory: Boolean(flags & FLAG_DIRECTORY),
    name: name ?? deriveName(relativePath),
    path: path ?? derivePath(root, relativePath),
    relativePath,
  };
};

/**
 * Keep the shallowest `max` entries, in their original order. A tree cut by
 * depth still renders every visible top-level row correctly; one cut by list
 * position would drop whole sibling folders from the root.
 *
 * Linear in the entry count: a repository can hold hundreds of thousands of
 * paths, and sorting the whole index on the renderer after every revalidation
 * would cost more than the read it is trying to make cheap. Count by depth,
 * find the depth that fills the cap, then take the entries in source order.
 */
const keepShallowest = (entries: ProjectFileIndexEntry[], max: number) => {
  if (entries.length <= max) return entries;

  const depths = new Uint32Array(entries.length);
  let maxDepth = 0;
  for (let i = 0; i < entries.length; i++) {
    const depth = depthOf(entries[i].relativePath);
    depths[i] = depth;
    if (depth > maxDepth) maxDepth = depth;
  }

  const counts = new Uint32Array(maxDepth + 1);
  for (let i = 0; i < depths.length; i++) counts[depths[i]] += 1;

  let remaining = max;
  let cutoff = 0;
  while (cutoff <= maxDepth && counts[cutoff] < remaining) {
    remaining -= counts[cutoff];
    cutoff += 1;
  }

  const kept: ProjectFileIndexEntry[] = [];
  for (let i = 0; i < entries.length && kept.length < max; i++) {
    const depth = depths[i];
    if (depth < cutoff) kept.push(entries[i]);
    else if (depth === cutoff && remaining > 0) {
      kept.push(entries[i]);
      remaining -= 1;
    }
  }
  return kept;
};

/**
 * A tree restored from a capped row: its deepest entries were not persisted.
 * It paints the first screen correctly, but it is not the whole project until
 * the network read replaces it — which is what the Files tab has to say when
 * that read does not come.
 */
export type PersistedProjectIndex = ProjectFileIndexResult & { persistedPartial?: true };

export const isPersistedPartialIndex = (data: ProjectFileIndexResult | undefined): boolean =>
  !!(data as PersistedProjectIndex | undefined)?.persistedPartial;

export const encodeProjectIndex = (
  data: PersistedProjectIndex,
  maxEntries = PROJECT_INDEX_PERSIST_MAX_ENTRIES,
): EncodedProjectIndex => {
  const kept = keepShallowest(data.entries, maxEntries);
  return {
    __codec: ENCODED_PROJECT_INDEX,
    // A restored partial tree written back before its refresh lands is still partial.
    ...(kept.length < data.entries.length || data.persistedPartial ? { capped: true } : {}),
    entries: kept.map((entry) => encodeEntry(data.root, entry)),
    indexedAt: data.indexedAt,
    root: data.root,
    source: data.source,
    ...(data.truncated ? { truncated: true } : {}),
  };
};

export const decodeProjectIndex = (encoded: EncodedProjectIndex): PersistedProjectIndex => ({
  entries: encoded.entries.map((entry) => decodeEntry(encoded.root, entry)),
  indexedAt: encoded.indexedAt,
  ...(encoded.capped ? { persistedPartial: true as const } : {}),
  root: encoded.root,
  source: encoded.source,
  ...(encoded.truncated ? { truncated: true } : {}),
});

const isEncodedProjectIndex = (value: unknown): value is EncodedProjectIndex =>
  !!value &&
  typeof value === 'object' &&
  (value as EncodedProjectIndex).__codec === ENCODED_PROJECT_INDEX &&
  Array.isArray((value as EncodedProjectIndex).entries);

const isGitWorkingTreeFiles = (value: unknown): value is GitWorkingTreeFiles =>
  !!value &&
  typeof value === 'object' &&
  Array.isArray((value as GitWorkingTreeFiles).added) &&
  Array.isArray((value as GitWorkingTreeFiles).modified) &&
  Array.isArray((value as GitWorkingTreeFiles).deleted);

export const isGitWorkingTreeFilesPersistable = (data: GitWorkingTreeFiles): boolean =>
  data.added.length + data.deleted.length + data.modified.length <=
  GIT_WORKING_TREE_PERSIST_MAX_PATHS;

/**
 * The overlay as stored: only the three buckets, and nothing at all past the
 * cap — a huge dirty set is not worth a stale first paint.
 */
export const encodeGitWorkingTreeFiles = (
  data: GitWorkingTreeFiles,
): GitWorkingTreeFiles | undefined => {
  if (!isGitWorkingTreeFilesPersistable(data)) return undefined;
  const { added, deleted, modified } = data;
  return { added, deleted, modified };
};

interface PersistCodec<TData, TStored> {
  decode: (stored: unknown) => TData | undefined;
  /** `undefined`: the value is not worth a row; the key's old row is dropped. */
  encode: (data: TData) => TStored | undefined;
}

/**
 * A replica storage that reshapes entry rows on the way in and out. The
 * engine's per-scope index row passes through untouched; a row that no longer
 * decodes (an older shape) reads as a miss.
 */
export const withPersistCodec = <TData, TStored>(
  inner: ReplicaStorage<any>,
  { decode, encode }: PersistCodec<TData, TStored>,
): ReplicaStorage<TData> => {
  const read = (row: ReplicaRow<unknown> | undefined, key: ReplicaRowKey) => {
    if (!row || key.queryKey === REPLICA_INDEX_KEY) return row as ReplicaRow<TData> | undefined;
    const data = decode(row.data);
    return data === undefined ? undefined : { data, updatedAt: row.updatedAt };
  };

  return {
    get: async (key) => read(await inner.get(key), key),
    getStrict: inner.getStrict && (async (key) => read(await inner.getStrict!(key), key)),
    remove: (key) => inner.remove(key),
    set: (key, row) => {
      if (key.queryKey === REPLICA_INDEX_KEY) return inner.set(key, row);
      const data = encode(row.data);
      // Too large to keep: drop what an earlier, smaller value left behind so
      // a reload never paints it.
      if (data === undefined) return inner.remove(key);
      return inner.set(key, { data, updatedAt: row.updatedAt });
    },
  };
};

export const projectIndexCodec: PersistCodec<PersistedProjectIndex, EncodedProjectIndex> = {
  decode: (stored) => (isEncodedProjectIndex(stored) ? decodeProjectIndex(stored) : undefined),
  encode: (data) => encodeProjectIndex(data),
};

export const gitWorkingTreeFilesCodec: PersistCodec<GitWorkingTreeFiles, GitWorkingTreeFiles> = {
  decode: (stored) => (isGitWorkingTreeFiles(stored) ? stored : undefined),
  encode: encodeGitWorkingTreeFiles,
};
