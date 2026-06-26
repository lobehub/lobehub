import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import { type RouteMetaParams } from '@/spa/router/routeMeta';

export type RouteWorkspaceId = string | null | undefined;

export const useRouteWorkspaceId = (params: RouteMetaParams): RouteWorkspaceId => {
  const workspaces = useWorkspaces();
  const workspaceSlug = params.workspaceSlug;

  if (!workspaceSlug) return null;

  return workspaces.find((workspace) => workspace.slug === workspaceSlug)?.id;
};

export const matchesRouteWorkspace = (
  itemWorkspaceId: string | null | undefined,
  routeWorkspaceId: RouteWorkspaceId,
): boolean => routeWorkspaceId !== undefined && (itemWorkspaceId ?? null) === routeWorkspaceId;
