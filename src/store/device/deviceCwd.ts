import type { WorkingDirEntry, WorkingDirRepoType } from '@lobechat/types';
import { getWorkingDirEffectivePath } from '@lobechat/types';

/** Max number of working directories persisted per device. Matches the
 * `workingDirs` cap enforced by the `device.updateDevice` tRPC input. */
export const WORKING_DIRS_MAX = 20;

/**
 * Compute the next `workingDirs` list after the user picks `entry`: move it to
 * the front (most-recent-first), drop any earlier entry with the same path, and
 * cap the length. Blank paths are ignored (returns the list unchanged).
 *
 * The server stores `workingDirs` verbatim — there is no server-side dedupe or
 * cap — so the client owns this logic.
 */
export const nextWorkingDirs = (
  entry: WorkingDirEntry,
  current: readonly WorkingDirEntry[] = [],
  max: number = WORKING_DIRS_MAX,
): WorkingDirEntry[] => {
  const path = entry.path.trim();
  if (!path) return [...current];
  const existing = current.find((d) => d.path === path);
  const nextEntry: WorkingDirEntry = { ...entry, path };

  if (!nextEntry.workspace && existing?.workspace) nextEntry.workspace = existing.workspace;
  if (!nextEntry.workspaceScannedAt && existing?.workspaceScannedAt) {
    nextEntry.workspaceScannedAt = existing.workspaceScannedAt;
  }

  return [nextEntry, ...current.filter((d) => d.path !== path)].slice(0, max);
};

/** Drop a path from a device's `workingDirs` recent list (used by the picker's
 * remove-recent affordance). */
export const removeWorkingDir = (
  path: string,
  current: readonly WorkingDirEntry[] = [],
): WorkingDirEntry[] => current.filter((d) => d.path !== path);

/**
 * Correct the cached `repoType` of the entry for `path` (matched by source or
 * active-worktree path, like the readers) in place — no reordering, no new
 * entry. `undefined` clears it (the dir is no longer a repo). Returns
 * `undefined` when no entry changes. Mirrors the server's `setWorkingDirRepoType`.
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
