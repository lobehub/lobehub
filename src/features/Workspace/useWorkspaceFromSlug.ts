'use client';

import { useParams } from 'react-router-dom';

import { useIsWorkspaceLoading } from '@/business/client/hooks/useIsWorkspaceLoading';
import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';

export type WorkspaceSlugStatus =
  | { status: 'no-slug' }
  | { status: 'loading'; slug: string }
  | { status: 'not-found'; slug: string }
  | { status: 'ok'; workspaceId: string; slug: string };

/**
 * Reads the `:workspaceSlug` URL param and resolves it to a status used by
 * `WorkspaceSlugBoundary` for the 404 screen.
 *
 * Store synchronisation (URL → activeWorkspaceId) lives in
 * `useWorkspaceUrlSync`, which is mounted globally — this hook is purely
 * read-side.
 */
export const useWorkspaceFromSlug = (): WorkspaceSlugStatus => {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const workspaces = useWorkspaces();
  const isLoading = useIsWorkspaceLoading();

  const matched = workspaceSlug ? (workspaces.find((w) => w.slug === workspaceSlug) ?? null) : null;

  if (!workspaceSlug) return { status: 'no-slug' };
  if (matched) return { status: 'ok', workspaceId: matched.id, slug: workspaceSlug };
  if (isLoading) return { status: 'loading', slug: workspaceSlug };
  return { status: 'not-found', slug: workspaceSlug };
};
