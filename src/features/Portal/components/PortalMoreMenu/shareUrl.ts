import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';

/**
 * Absolute link for the menu's copy-link capability. Not `window.location`:
 * on desktop that is the `app://renderer` shell — the link is the app origin
 * plus the entity route, carrying the active workspace prefix so it resolves
 * in the same workspace. `undefined` (capability hidden) when either the
 * origin or the route is unknown, because a relative link cannot be shared.
 */
export const buildPortalShareUrl = (
  appOrigin: string | null | undefined,
  path: string | null | undefined,
  workspaceSlug: string | null | undefined,
): string | undefined => {
  if (!appOrigin || !path) return;

  return `${appOrigin}${buildWorkspaceAwarePath(path, workspaceSlug)}`;
};

export const usePortalShareUrl = (path: string | null | undefined): string | undefined => {
  const appOrigin = useAppOrigin();
  const workspaceSlug = useActiveWorkspaceSlug();

  return buildPortalShareUrl(appOrigin, path, workspaceSlug);
};
