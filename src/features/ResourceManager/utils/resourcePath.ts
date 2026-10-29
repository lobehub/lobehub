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

/** Path of a library's explorer: `/resource/library/<id>`. */
export const buildLibraryPath = (
  libraryId: string,
  activeWorkspaceSlug: string | null | undefined,
): string => buildWorkspaceAwarePath(`/resource/library/${libraryId}`, activeWorkspaceSlug);

/**
 * Path that opens a page: `/resource/page/<id>`, or the library-scoped
 * `/resource/library/<libraryId>?file=<id>` when the page lives in a library.
 */
export const buildPagePath = (
  fileId: string,
  activeWorkspaceSlug: string | null | undefined,
  libraryId?: string | null,
): string =>
  buildWorkspaceAwarePath(
    libraryId ? `/resource/library/${libraryId}?file=${fileId}` : docsPagePath(fileId),
    activeWorkspaceSlug,
  );

/** Path that opens an uploaded file in Docs: `/resource/file/<id>`. */
export const buildFilePath = (
  fileId: string,
  activeWorkspaceSlug: string | null | undefined,
): string => buildWorkspaceAwarePath(docsFilePath(fileId), activeWorkspaceSlug);
