import type { WorkingDirEntry, WorkingDirRepoType } from '@lobechat/types';
import { getWorkingDirEffectivePath } from '@lobechat/types';

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

/**
 * Correct the cached `repoType` of the entry for `path` (matched by source or
 * active-worktree path, like the readers) in place — no reordering, no new
 * entry, every other field kept. `undefined` clears it (the dir is no longer a
 * repo). Returns `undefined` when no entry changes. Mirrors the client's
 * optimistic `setWorkingDirRepoType`.
 */
export const setWorkingDirRepoType = (
  current: readonly WorkingDirEntry[],
  path: string,
  repoType: WorkingDirRepoType | undefined,
): WorkingDirEntry[] | undefined => {
  let changed = false;
  const next = current.map((dir) => {
    if (dir.path !== path && getWorkingDirEffectivePath(dir) !== path) return dir;
    if (dir.repoType === repoType) return dir;
    changed = true;
    const { repoType: _previous, ...rest } = dir;
    return repoType ? { ...rest, repoType } : rest;
  });
  return changed ? next : undefined;
};
