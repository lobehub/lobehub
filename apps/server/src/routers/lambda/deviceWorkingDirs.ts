import type { WorkingDirEntry } from '@lobechat/types';

/**
 * Re-attach the server-owned workspace-init cache (`workspace` /
 * `workspaceScannedAt`) onto a client-supplied `workingDirs` list, matched by
 * `path`.
 *
 * The device update inputs validate only user-owned directory metadata
 * (`path`, `repoType`, `git`) and zod strips everything else, so a client cwd
 * save would otherwise overwrite the JSONB column with cache-less entries —
 * wiping the scan written by `resolveWorkspaceInit` and forcing every later run
 * to rescan. The cache is server-produced (the client never authors it), so we
 * restore it here rather than trusting the client to round-trip it.
 *
 * Entries dropped from `incoming` (e.g. the user removed a dir) lose their cache
 * by design; brand-new paths simply have none yet.
 */
export const preserveWorkspaceCache = (
  incoming: WorkingDirEntry[],
  stored: readonly WorkingDirEntry[] = [],
): WorkingDirEntry[] => {
  const cachedByPath = new Map(stored.filter((dir) => dir.workspace).map((dir) => [dir.path, dir]));
  if (cachedByPath.size === 0) return incoming;

  return incoming.map((entry) => {
    const cached = cachedByPath.get(entry.path);
    return cached
      ? { ...entry, workspace: cached.workspace, workspaceScannedAt: cached.workspaceScannedAt }
      : entry;
  });
};

/** Max recent working directories kept per device (matches the update input cap). */
export const WORKING_DIRS_MAX = 20;

/**
 * Move `entry` to the front of `current` (most-recent-first), replacing any entry
 * with the same path while keeping its server-owned workspace cache, and cap the
 * list. Mirrors the client's optimistic `nextWorkingDirs`.
 */
export const upsertWorkingDir = (
  entry: WorkingDirEntry,
  current: readonly WorkingDirEntry[],
): WorkingDirEntry[] => {
  const path = entry.path.trim();
  if (!path) return [...current];
  const [next] = preserveWorkspaceCache([{ ...entry, path }], current);
  return [next, ...current.filter((dir) => dir.path !== path)].slice(0, WORKING_DIRS_MAX);
};
