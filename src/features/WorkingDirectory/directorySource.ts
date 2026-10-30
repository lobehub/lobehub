import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * One folder as a directory picker lists it, whichever machine or drive it is
 * on.
 */
export interface DirectoryEntry {
  /** At the row's end: a menu of what can be done to the folder — rename, delete. */
  actions?: ReactNode;
  /** Under the name: why it cannot be opened, or what it is. */
  description?: ReactNode;
  disabled?: boolean;
  /** In place of the folder glyph. */
  icon?: LucideIcon;
  name: string;
  path: string;
  /** Always shown on the right of the row: what it is, whether it is in use. */
  tags?: ReactNode;
}

/** One folder's listing, and the ways to move through it. */
export interface DirectoryListing {
  /** Where the listing is; absent until the first answer arrives. */
  directory?: { parentPath?: string | null; path: string; roots?: string[] };
  entries: DirectoryEntry[];
  error?: unknown;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  loadMore: () => void;
  /** Above the entries: something about this folder worth saying before its contents. */
  notice?: ReactNode;
  refresh: () => Promise<void>;
  retry: () => void;
}

/**
 * Where a directory picker reads folders from and writes new ones to — the
 * one difference between picking a folder on a device and on the cloud
 * sandbox's drive. The picker itself (navigation, the new-folder row, the
 * empty and error states) is the same for both.
 *
 * `useListing` is a hook: a source is made by a hook of its own, and the
 * browser calls this unconditionally on every render.
 */
export interface DirectorySource {
  /**
   * Make a folder inside `parentPath`.
   */
  createFolder: (parentPath: string, name: string) => Promise<{ path: string }>;
  /** How the path is shown in the address field; the raw path when absent. */
  displayPath?: (path: string) => string;
  /** Whether a path can be typed in by hand. A device's can; the drive is browsed. */
  editablePath: boolean;
  /** Translation key for an error the source's create threw, or `undefined` for the generic one. */
  folderErrorKey?: (error: unknown) => string | undefined;
  /**
   * Translation key for a listing that failed, when the generic one — which
   * speaks of a device connection and a typed path — does not fit the source.
   */
  listErrorKey?: 'workingDirectory.drive.foldersLoadFailed';
  /**
   * Why the folder being browsed cannot be chosen, or `undefined` when it
   * can. A shared drive's root is the one such folder today.
   */
  selectBlockedReason?: (path: string) => string | undefined;
  useListing: (path?: string) => DirectoryListing;
}

/**
 * What the path field shows. Without a listing — still loading, or failed —
 * the folder asked for is shown in the source's own form (`/` for a drive's
 * top level), not left empty for a placeholder that describes device paths.
 */
export const displayedDirectoryPath = ({
  directoryPath,
  displayPath,
  draft,
  requestedPath,
}: {
  directoryPath?: string;
  displayPath?: (path: string) => string;
  draft?: string;
  requestedPath?: string;
}): string => {
  if (draft !== undefined) return draft;
  const shown = directoryPath ?? requestedPath;
  if (shown === undefined) return displayPath?.('') ?? '';

  return displayPath?.(shown) ?? shown;
};
