import { docsFilePath, docsPagePath } from '@/features/ResourceHome/paths';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

/**
 * Route builders for resource surfaces that are reached outside the router's
 * own navigation (copied links, `window.open`, `window.location`).
 *
 * `useWorkspaceAwareNavigate` prefixes in-app navigation automatically, but
 * these hand-built URLs must carry the active workspace slug themselves or
 * they land in the personal scope, where a workspace library or page does not
 * resolve.
 */

/**
 * Library path segment of an item: pages (`docs_` ids) open under `docs`,
 * everything else under `file`.
 */
export const libraryItemSegment = (itemId: string): 'docs' | 'file' =>
  itemId.startsWith('docs_') ? 'docs' : 'file';

/** Where an item opens inside a library: `/resource/library/<id>/{docs,file}/<itemId>`. */
export const libraryItemPath = (libraryId: string, itemId: string): string =>
  `/resource/library/${libraryId}/${libraryItemSegment(itemId)}/${encodeURIComponent(itemId)}`;

/** A page or file opened inside a library by path. */
export const LIBRARY_ITEM_PATH = /\/resource\/library\/[^/]+\/(?:docs|file)\/[^/]+\/?$/;

/** Swap the `/resource/library/…` tail of `pathname` for `path`, keeping a workspace prefix. */
export const rebaseLibraryPath = (pathname: string, path: string): string =>
  pathname.replace(/\/resource\/library\/.*$/, path);

/**
 * Library items used to open as `/resource/library/<id>[/<folder>]?file=<itemId>`.
 * Returns where such a URL lives now (workspace prefix and other query kept),
 * or `null` when it is not a legacy item link.
 */
export const legacyLibraryItemRedirect = (
  pathname: string,
  search: string,
  libraryId: string,
): { pathname: string; search: string } | null => {
  const params = new URLSearchParams(search);
  const itemId = params.get('file');
  if (!itemId || LIBRARY_ITEM_PATH.test(pathname)) return null;

  params.delete('file');
  const query = params.toString();
  return {
    pathname: rebaseLibraryPath(pathname, libraryItemPath(libraryId, itemId)),
    search: query ? `?${query}` : '',
  };
};

/** A library's explorer, or one of its folders: `/resource/library/<id>[/folder/<folderId>]`. */
export const libraryFolderPath = (libraryId: string, folderId?: string | null): string =>
  `/resource/library/${libraryId}${folderId ? `/folder/${encodeURIComponent(folderId)}` : ''}`;

/** Path of a library's explorer: `/resource/library/<id>`. */
export const buildLibraryPath = (
  libraryId: string,
  activeWorkspaceSlug: string | null | undefined,
): string => buildWorkspaceAwarePath(`/resource/library/${libraryId}`, activeWorkspaceSlug);

/**
 * Path that opens a page: `/resource/page/<id>`, or the library-scoped
 * `/resource/library/<libraryId>/docs/<id>` when the page lives in a library.
 */
export const buildPagePath = (
  fileId: string,
  activeWorkspaceSlug: string | null | undefined,
  libraryId?: string | null,
): string =>
  buildWorkspaceAwarePath(
    libraryId ? libraryItemPath(libraryId, fileId) : docsPagePath(fileId),
    activeWorkspaceSlug,
  );

/** Path that opens an uploaded file in Docs: `/resource/file/<id>`. */
export const buildFilePath = (
  fileId: string,
  activeWorkspaceSlug: string | null | undefined,
): string => buildWorkspaceAwarePath(docsFilePath(fileId), activeWorkspaceSlug);
