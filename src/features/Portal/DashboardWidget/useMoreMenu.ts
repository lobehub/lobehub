import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';
import { useServerConfigStore } from '@/store/serverConfig';

import { useOpenDashboard } from './useOpenDashboard';

export const useDashboardWidgetMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const view = useChatStore(chatPortalSelectors.dashboardWidgetView);
  const widget = useDashboardStore(dashboardSelectors.widgetDetail(view?.widgetId));
  const refreshWidget = useDashboardStore((s) => s.refreshWidget);
  const openDashboard = useOpenDashboard();
  // Dashboard routes exist only in the desktop shell — on mobile opening one
  // would just clear the Portal stack onto nothing.
  const isMobile = useServerConfigStore((s) => s.isMobile);

  if (!view) return;
  const { widgetId } = view;

  return {
    copyId: widgetId,
    // The widget's own page is the board it sits on; without one, the board
    // list of its project — or home when it lives outside projects.
    openInPage: isMobile
      ? undefined
      : () => openDashboard(widget?.dashboards[0], widget?.projectId),
    refresh: () => refreshWidget(widgetId),
  };
};
