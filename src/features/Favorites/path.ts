/**
 * The in-app path a favorite stores: the location without the workspace slug,
 * so the client can add whichever workspace prefix is active when it
 * navigates (`useWorkspaceAwareNavigate` / `WorkspaceLink`).
 */
export const toFavoritePath = (pathname: string, workspaceSlug: string | null): string => {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (!workspaceSlug) return path;

  const prefix = `/${workspaceSlug}`;
  if (path === prefix) return '/';
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
};
