import { getProjectDashboardPath } from '@/features/Projects/Layout/navigation';

/**
 * Where a board opens: inside its project's shell (sidebar, back to the
 * project's boards) when it belongs to one, else on the home dashboards.
 */
export const getDashboardPath = (dashboard: { id: string; projectId?: string | null }) =>
  dashboard.projectId
    ? getProjectDashboardPath(dashboard.projectId, dashboard.id)
    : `/dashboard/${dashboard.id}`;
