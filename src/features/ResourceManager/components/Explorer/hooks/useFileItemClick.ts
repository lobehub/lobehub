import { useCallback } from 'react';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { libraryFolderPath, libraryItemPath } from '@/features/ResourceManager/utils/resourcePath';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';

export interface UseFileItemClickOptions {
  id: string;
  isFolder: boolean;
  isPage: boolean;
  libraryId?: string | null;
  onOpen?: (id: string) => void;
  /**
   * Explorer rows (list / masonry) outside a knowledge base preview files and
   * pages in the inline right detail panel. Inside a knowledge base the content
   * itself is the point of the visit, so a click opens the detail directly. The
   * library sidebar tree is navigation and also stays mounted where no explorer
   * (and so no panel) exists, e.g. the Permissions page, so it keeps opening the
   * fullscreen editor.
   */
  openInPanel?: boolean;
}

/**
 * How long a first click waits before expanding a closed detail panel. Expanding
 * the panel narrows the explorer (the masonry drops columns), which can move the
 * clicked card before a second click lands and swallow the double click.
 */
export const DETAIL_PANEL_OPEN_DELAY_MS = 250;

/**
 * Open an item: inside a library by path (`/resource/library/<id>/{docs,file}/<itemId>`),
 * elsewhere through the `?file=` query. View and sort preferences in the query are kept.
 */
const openItemUrl = (
  id: string,
  libraryId: string | null | undefined,
  search: string,
): { pathname?: string; search: string } => {
  const params = new URLSearchParams(search);
  if (!libraryId) {
    params.set('file', id);
    return { search: `?${params.toString()}` };
  }

  params.delete('file');
  const query = params.toString();
  return { pathname: libraryItemPath(libraryId, id), search: query ? `?${query}` : '' };
};

let pendingPanelOpen: ReturnType<typeof setTimeout> | undefined;

const cancelPendingPanelOpen = () => {
  if (pendingPanelOpen === undefined) return;

  clearTimeout(pendingPanelOpen);
  pendingPanelOpen = undefined;
};

/**
 * Shared hook for handling file item click across different view modes (list/masonry)
 */
export const useFileItemClick = ({
  id,
  libraryId,
  isFolder,
  isPage,
  onOpen,
  openInPanel = false,
}: UseFileItemClickOptions) => {
  const navigate = useWorkspaceAwareNavigate();
  // Read/write the URL through the active-tab facade rather than
  // `useSearchParams`: this hook also runs in the library sidebar, which Electron
  // portals into the shell's frozen root router.
  const { search } = useActiveLocation();
  const setMode = useResourceManagerStore((s) => s.setMode);
  const setCurrentViewItemId = useResourceManagerStore((s) => s.setCurrentViewItemId);
  const openDetailPanel = useResourceManagerStore((s) => s.openDetailPanel);
  const closeDetailPanel = useResourceManagerStore((s) => s.closeDetailPanel);

  const handleClick = useCallback(() => {
    const selectFile = () => {
      const target = openItemUrl(id, libraryId, search);

      // Inside a library the item has its own path (also leaves the Permissions page).
      if (target.pathname) {
        navigate(`${target.pathname}${target.search}`);
        return;
      }

      navigate({ search: target.search }, { replace: true });
    };

    if (isFolder) {
      if (libraryId) {
        // Preserve existing query parameters (view and sort preferences)
        const newParams = new URLSearchParams(search);
        // Remove 'file' parameter when navigating to folder
        newParams.delete('file');

        const queryString = newParams.toString();
        const basePath = libraryFolderPath(libraryId, id);
        navigate(queryString ? `${basePath}?${queryString}` : basePath);
      }
      return;
    }

    if (openInPanel && !libraryId) {
      // A plain click is a "look at this" gesture — the promise of the explorer
      // is to keep the working list visible. Fullscreen focus stays available as
      // the explicit double click (see `useFileItemDoubleClick`).
      const open = () => {
        openDetailPanel(id, isPage);
        onOpen?.(id);
      };

      cancelPendingPanelOpen();
      // Switching an already open panel keeps the layout, so it can be instant.
      if (useResourceManagerStore.getState().detailPanelId) {
        open();
        return;
      }

      pendingPanelOpen = setTimeout(() => {
        pendingPanelOpen = undefined;
        open();
      }, DETAIL_PANEL_OPEN_DELAY_MS);
      return;
    }

    // The preview state is global: drop a panel left open elsewhere so leaving
    // the editor doesn't reveal a stale preview.
    cancelPendingPanelOpen();
    closeDetailPanel();
    setCurrentViewItemId(id);
    setMode(isPage ? 'page' : 'editor');
    // Update URL query parameter for shareable links
    selectFile();
    onOpen?.(id);
  }, [
    isFolder,
    id,
    libraryId,
    isPage,
    navigate,
    openInPanel,
    search,
    setMode,
    setCurrentViewItemId,
    openDetailPanel,
    closeDetailPanel,
    onOpen,
  ]);

  return handleClick;
};

/**
 * Double click = the committed "open this item" gesture: leave the list into
 * the fullscreen page editor or file editor. Writes the item's path (library) or
 * `?file=` query so a restored tab still lands on this item.
 */
export const useFileItemDoubleClick = ({
  id,
  isPage,
  libraryId,
}: {
  id: string;
  isPage: boolean;
  libraryId?: string | null;
}) => {
  const setMode = useResourceManagerStore((s) => s.setMode);
  const setCurrentViewItemId = useResourceManagerStore((s) => s.setCurrentViewItemId);
  const closeDetailPanel = useResourceManagerStore((s) => s.closeDetailPanel);
  const { pathname, search } = useActiveLocation();
  const navigate = useWorkspaceAwareNavigate();

  return useCallback(() => {
    // Both clicks of the double click scheduled a panel open; drop it.
    cancelPendingPanelOpen();
    closeDetailPanel();
    setCurrentViewItemId(id);
    setMode(isPage ? 'page' : 'editor');

    const target = openItemUrl(id, libraryId, search);
    if (target.pathname) {
      // The single click already opened the item; don't stack a second entry.
      if (pathname.endsWith(target.pathname)) return;
      navigate(`${target.pathname}${target.search}`);
      return;
    }

    navigate({ search: target.search }, { replace: true });
  }, [
    closeDetailPanel,
    id,
    isPage,
    libraryId,
    setCurrentViewItemId,
    setMode,
    navigate,
    pathname,
    search,
  ]);
};
