'use client';

import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useIsWorkspaceLoading } from '@/business/client/hooks/useIsWorkspaceLoading';
import { useSwitchWorkspace } from '@/business/client/hooks/useSwitchWorkspace';
import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';

/**
 * Top-level route segments that share the namespace with `:workspaceSlug`.
 * Anything starting with one of these is NOT a workspace slug — even if the
 * first segment happens to resemble one.
 *
 * Kept in sync with `sharedMainAreaChildren` (paths) + the personal-only list
 * in router configs. If you add a new root path segment, add it here too.
 */
const RESERVED_FIRST_SEGMENTS = new Set([
  // Shared (mirrored under /:workspaceSlug too):
  'agent',
  'group',
  'community',
  'memory',
  'page',
  'resource',
  'image',
  'video',
  'eval',
  'tasks',
  'task',
  // Personal-only:
  'settings',
  'onboarding',
  'me',
  'share',
  'devtools',
  'desktop-onboarding',
]);

const FIRST_SEGMENT_REGEX = /^\/([^/?#]+)/;

const parseFirstSegment = (pathname: string): string | null => {
  const match = pathname.match(FIRST_SEGMENT_REGEX);
  return match ? match[1] : null;
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
  const { pathname } = useLocation();
  const workspaces = useWorkspaces();
  const activeId = useActiveWorkspaceId();
  const isLoading = useIsWorkspaceLoading();
  const { switchWorkspace, switchToPersonal } = useSwitchWorkspace();

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

    const first = parseFirstSegment(pathname);

    if (first && !RESERVED_FIRST_SEGMENTS.has(first)) {
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
