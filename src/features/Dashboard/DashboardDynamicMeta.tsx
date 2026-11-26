import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

/** Names the tab after the open board, from the detail the board page loads. */
const DashboardDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const title = useDashboardStore(
    (s) => dashboardSelectors.dashboardDetail(params.dashboardId)(s)?.title,
  );

  usePublishDynamicRouteMeta({ title: title || undefined }, onResolve);

  return null;
};

export default DashboardDynamicMeta;
