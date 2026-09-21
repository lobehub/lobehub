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
 * Path that opens a page: `/resource?file=<id>`, or the library-scoped
 * `/resource/library/<libraryId>?file=<id>` when the page lives in a library.
 */
export const buildPagePath = (
  fileId: string,
  activeWorkspaceSlug: string | null | undefined,
  libraryId?: string | null,
): string =>
  buildWorkspaceAwarePath(
    libraryId ? `/resource/library/${libraryId}?file=${fileId}` : `/resource?file=${fileId}`,
    activeWorkspaceSlug,
  );
