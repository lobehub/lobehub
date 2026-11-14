/**
 * Whether a pathname is the Home page: `/` in personal scope, or the workspace
 * root (`/<slug>` / `/<slug>/`) when a workspace is active.
 */
export const isHomePathname = (pathname: string, workspaceSlug?: string | null): boolean =>
  pathname === '/' ||
  (!!workspaceSlug && (pathname === `/${workspaceSlug}` || pathname === `/${workspaceSlug}/`));
