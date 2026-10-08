import { getProjectDashboardPath } from '@/features/Projects/Layout/navigation';

/**
 * Where a board opens: inside its project's shell (sidebar, back to the
 * project's boards) when it belongs to one, else on the home dashboards.
 */
export const getDashboardPath = (dashboard: { id: string; projectId?: string | null }) =>
  dashboard.projectId
    ? getProjectDashboardPath(dashboard.projectId, dashboard.id)
    : `/dashboard/${dashboard.id}`;

/**
 * Where the home board route sends a board that actually lives in a project:
 * into its project path, so it renders with the project shell and back path
 * instead of the home chrome. Home boards stay on this route (`undefined`),
 * and an unloaded board is not redirected yet.
 */
export const getHomeDashboardRedirect = (
  dashboard?: { id: string; projectId?: string | null } | null,
): string | undefined =>
  dashboard?.projectId ? getProjectDashboardPath(dashboard.projectId, dashboard.id) : undefined;
