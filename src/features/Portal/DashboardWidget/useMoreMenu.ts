import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import { useOpenDashboard } from './useOpenDashboard';

export const useDashboardWidgetMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const view = useChatStore(chatPortalSelectors.dashboardWidgetView);
  const widget = useDashboardStore(dashboardSelectors.widgetDetail(view?.widgetId));
  const refreshWidget = useDashboardStore((s) => s.refreshWidget);
  const openDashboard = useOpenDashboard();

  if (!view) return;
  const { widgetId } = view;

  return {
    copyId: widgetId,
    // The widget's own page is the board it sits on; without one, the board list.
    openInPage: () => openDashboard(widget?.dashboards[0]),
    refresh: () => refreshWidget(widgetId),
  };
};
