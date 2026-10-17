import type { DashboardWidgetItem } from '@/services/dashboard';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

/**
 * The widget's long-term trend from `metric_points`. Every card and drill-down
 * showing the same widget shares one request through the SWR key.
 */
export const useWidgetTrend = (widget: DashboardWidgetItem) => {
  const useFetchWidgetTrend = useDashboardStore((s) => s.useFetchWidgetTrend);
  useFetchWidgetTrend(widget);
  return useDashboardStore(dashboardSelectors.widgetTrend(widget.id));
};
