import type { WorkingDirEntry } from '@lobechat/types';

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
  return [{ ...entry, path }, ...current.filter((d) => d.path !== path)].slice(0, max);
};

/** Drop a path from a device's `workingDirs` recent list (used by the picker's
 * remove-recent affordance). */
export const removeWorkingDir = (
  path: string,
  current: readonly WorkingDirEntry[] = [],
): WorkingDirEntry[] => current.filter((d) => d.path !== path);
