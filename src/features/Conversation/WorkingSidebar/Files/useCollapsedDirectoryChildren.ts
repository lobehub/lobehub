import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSingleton } from '@/hooks/useSingleton';
import { projectFileService } from '@/services/projectFile';

import { getParentRelativePath } from './treePaths';

interface UseCollapsedDirectoryChildrenParams {
  deviceId?: string;
  /** Indexed entries; tells the hook which expanded rows the index collapsed. */
  entries: ProjectFileIndexEntry[];
  /** Currently expanded tree ids (entry relativePaths). */
  expandedIds: string[];
  projectRoot: string;
}

interface CollapsedDirectoryChildren {
  children: ProjectFileIndexEntry[];
  /**
   * Forget every listing so expanded collapsed directories are read again —
   * call it after a write, since the listings are not part of the SWR index.
   */
  invalidate: () => void;
  /** Expanded directories whose on-disk listing exceeded the host-side cap. */
  truncatedCount: number;
}

/**
 * Listed children the tree should still show: those whose parent is a
 * collapsed directory (indexed, or itself a listed child still shown) and that
 * the index does not list itself. A write can turn a collapsed folder into an
 * indexed one — pasting into a new empty folder does — and its old listing
 * must then yield to the index instead of duplicating its rows.
 */
export const selectCollapsedChildren = (
  entries: ProjectFileIndexEntry[],
  children: ProjectFileIndexEntry[],
): ProjectFileIndexEntry[] => {
  if (children.length === 0) return children;
  const indexed = new Map(entries.map((entry) => [entry.relativePath, entry]));
  const listed = new Map(children.map((child) => [child.relativePath, child]));
  const visible = new Map<string, boolean>();

  const isVisible = (child: ProjectFileIndexEntry): boolean => {
    const cached = visible.get(child.relativePath);
    if (cached !== undefined) return cached;
    visible.set(child.relativePath, false);
    const parentPath = getParentRelativePath(child.relativePath);
    const indexedParent = parentPath ? indexed.get(parentPath) : undefined;
    const listedParent = parentPath ? listed.get(parentPath) : undefined;
    const result =
      !indexed.has(child.relativePath) &&
      (indexedParent
        ? !!indexedParent.collapsed
        : !!listedParent?.collapsed && isVisible(listedParent));
    visible.set(child.relativePath, result);
    return result;
  };

  return children.filter(isVisible);
};

/**
 * Children of collapsed (fully git-ignored) directories, fetched one level at a
 * time as the user expands them. The project index deliberately omits these
 * subtrees (`collapsed: true`), so the tree backfills them via
 * `listProjectDirectory` — an ignored subtree is read only when someone opens
 * it. Returned children carry their own `collapsed` flags, so nested
 * directories keep expanding on demand. Transport (local IPC vs remote device
 * RPC) is picked inside `projectFileService` from `deviceId`.
 */
export const useCollapsedDirectoryChildren = ({
  deviceId,
  entries,
  expandedIds,
  projectRoot,
}: UseCollapsedDirectoryChildrenParams): CollapsedDirectoryChildren => {
  const scopeKey = `${deviceId ?? ''}\0${projectRoot}`;
  const [loaded, setLoaded] = useState<{
    entries: ProjectFileIndexEntry[];
    scopeKey: string;
    truncatedDirs: string[];
  }>({ entries: [], scopeKey, truncatedDirs: [] });
  // relativePath → scope it was requested for; dedupes fetches and drops stale resolves.
  const requested = useSingleton(() => new Map<string, string>());

  useEffect(() => {
    requested.clear();
  }, [scopeKey]);

  const children = loaded.scopeKey === scopeKey ? loaded.entries : [];
  const visibleChildren = useMemo(
    () => selectCollapsedChildren(entries, children),
    [children, entries],
  );
  const truncatedCount = loaded.scopeKey === scopeKey ? loaded.truncatedDirs.length : 0;

  useEffect(() => {
    const knownEntries = new Map(
      [...entries, ...children].map((entry) => [entry.relativePath, entry]),
    );

    for (const id of expandedIds) {
      if (requested.has(id)) continue;
      const entry = knownEntries.get(id);
      if (!entry?.isDirectory || !entry.collapsed) continue;

      requested.set(id, scopeKey);
      void Promise.resolve(
        projectFileService.listProjectDirectory({ deviceId, relativePath: id, root: projectRoot }),
      )
        .then((result) => {
          if (requested.get(id) !== scopeKey) return;
          if (!result) {
            // The file host answered nothing (e.g. remote device offline). Drop
            // the marker so collapsing and re-expanding retries after reconnect.
            requested.delete(id);
            return;
          }
          setLoaded((previous) => {
            const base = previous.scopeKey === scopeKey ? previous.entries : [];
            const baseTruncated = previous.scopeKey === scopeKey ? previous.truncatedDirs : [];
            const freshPaths = new Set(result.entries.map((child) => child.relativePath));
            // A re-read replaces the directory's listing, so drop children
            // that are gone from disk along with the ones being refreshed.
            return {
              entries: [
                ...base.filter(
                  (child) =>
                    !freshPaths.has(child.relativePath) &&
                    getParentRelativePath(child.relativePath) !== id,
                ),
                ...result.entries,
              ],
              scopeKey,
              truncatedDirs:
                result.truncated && !baseTruncated.includes(id)
                  ? [...baseTruncated, id]
                  : baseTruncated,
            };
          });
        })
        .catch((error) => {
          // Allow a retry the next time the row is expanded.
          requested.delete(id);
          console.error('[Files] Failed to list collapsed directory:', error);
        });
    }
  }, [children, deviceId, entries, expandedIds, projectRoot, scopeKey]);

  const invalidate = useCallback(() => {
    requested.clear();
    // Keep what is shown until the re-read lands; a fresh array identity is
    // what re-runs the fetch effect for every expanded collapsed directory.
    setLoaded((previous) => ({ ...previous, entries: [...previous.entries] }));
  }, [requested]);

  return { children: visibleChildren, invalidate, truncatedCount };
};
