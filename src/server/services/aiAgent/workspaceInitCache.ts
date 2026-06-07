import type { WorkingDirEntry } from '@lobechat/database/schemas';
import type { WorkspaceInitResult } from '@lobechat/types';

/** Reuse a cached workspace-init scan for this long before re-scanning the device. */
export const WORKSPACE_INIT_TTL_MS = 60 * 60 * 1000;

/**
 * Cap on `workingDirs` entries when prepending a newly-scanned bound cwd. Matches
 * the client-side `WORKING_DIRS_MAX`; the client owns dedupe/ordering, so here we
 * only guard the length when inserting a previously-unrecorded directory.
 */
export const WORKSPACE_INIT_MAX_DIRS = 20;

/**
 * True when a cached workspace scan exists and is still within its TTL — i.e. it
 * can be reused without a fresh device round-trip.
 */
export const isWorkspaceCacheFresh = (entry: WorkingDirEntry | undefined, now: number): boolean =>
  !!entry?.workspace &&
  typeof entry.workspaceScannedAt === 'number' &&
  now - entry.workspaceScannedAt < WORKSPACE_INIT_TTL_MS;

/**
 * Merge a fresh scan into a device's `workingDirs`: update the matching entry in
 * place (preserving its `repoType`), or prepend a new most-recent-first entry
 * when the bound cwd wasn't recorded yet — mirroring the client's
 * `nextWorkingDirs` MRU convention, capped at {@link WORKSPACE_INIT_MAX_DIRS}.
 */
export const upsertWorkspaceScan = (
  workingDirs: readonly WorkingDirEntry[],
  path: string,
  workspace: WorkspaceInitResult,
  scannedAt: number,
): WorkingDirEntry[] => {
  if (workingDirs.some((dir) => dir.path === path)) {
    return workingDirs.map((dir) =>
      dir.path === path ? { ...dir, workspace, workspaceScannedAt: scannedAt } : dir,
    );
  }

  return [{ path, workspace, workspaceScannedAt: scannedAt }, ...workingDirs].slice(
    0,
    WORKSPACE_INIT_MAX_DIRS,
  );
};
