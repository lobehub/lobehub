import { type PortalImpl } from '../type';
import Body from './Body';
import Title from './Title';
import { useDashboardWidgetMoreMenu } from './useMoreMenu';

export const DashboardWidget: PortalImpl = {
  Body,
  Title,
  useMoreMenu: useDashboardWidgetMoreMenu,
};
