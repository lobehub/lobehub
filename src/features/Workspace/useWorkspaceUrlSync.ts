'use client';

import { useLayoutEffect } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useIsWorkspaceLoading } from '@/business/client/hooks/useIsWorkspaceLoading';
import { useSilentSwitchWorkspace } from '@/business/client/hooks/useSwitchWorkspace';
import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';

import { parseRootSegment, RESERVED_ROOT_SEGMENTS } from './rootSegments';
import { useWorkspaceSyncPathname } from './useWorkspaceSyncPathname';

/**
 * Whether `pathname`'s first segment could be an (as-yet-unresolved) workspace
 * slug — i.e. it's present and not one of the reserved root segments.
 *
 * Top-level rendering only needs to block on the workspace list (to avoid a
 * false 404 / wrong-scope paint) when this is `true`. On personal / reserved
 * routes (`/`, `/agent/...`, `/settings/...`) the list isn't required to render,
 * so callers can show personal context immediately and let the list hydrate in
 * the background.
 */
export const isWorkspaceSlugCandidatePath = (pathname: string): boolean => {
  const first = parseRootSegment(pathname);
  return !!first && !RESERVED_ROOT_SEGMENTS.has(first);
};

/**
 * URL is the source of truth for workspace context.
 *
 * - `/{slug}/...` where `slug` is a known workspace → activate that workspace
 * - `/` or `/agent/...` / `/settings/...` etc. (or any non-slug surface) → personal
 * - `/{unknown}/...` (slug not in workspaces) → leave store alone so
 *   `WorkspaceSlugBoundary` can render its 404
 */
export const useWorkspaceUrlSync = (): void => {
  const pathname = useWorkspaceSyncPathname();
  const workspaces = useWorkspaces();
  const activeId = useActiveWorkspaceId();
  const isLoading = useIsWorkspaceLoading();
  // URL is a passive source, not an explicit user intent — use the silent
  // variant so refreshing or following a `/{slug}` link is not treated as
  // a user-driven switch.
  const { switchWorkspace, switchToPersonal } = useSilentSwitchWorkspace();

  // `useLayoutEffect` (not `useEffect`) so the workspace switch is scheduled
  // before the browser paints. With `useEffect` there is one paintable frame
  // between `isWorkspaceLoading: false` and `switchWorkspace()` running, which
  // causes downstream consumers (e.g. `WorkspaceContextSlot`) to briefly see
  // `isContextReady === true` and unhide stale children before the splash
  // re-asserts itself.
  useLayoutEffect(() => {
    // Defer until the workspace list has loaded so we don't briefly flip the
    // store to "personal" on first paint of a `/{slug}` URL.
    if (isLoading) return;

    const first = parseRootSegment(pathname);

    if (first && !RESERVED_ROOT_SEGMENTS.has(first)) {
      const ws = workspaces.find((w) => w.slug === first);
      if (ws) {
        if (activeId !== ws.id) void switchWorkspace(ws.id);
        return;
      }
      // Unknown slug — let `WorkspaceSlugBoundary` show 404; don't touch the
      // active workspace.
      return;
    }

    // URL has no workspace slug → personal context.
    if (activeId !== null) void switchToPersonal();
  }, [pathname, workspaces, isLoading, activeId, switchWorkspace, switchToPersonal]);
};
