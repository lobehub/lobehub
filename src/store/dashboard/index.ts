import { useDashboardStore } from './store';

export const getDashboardStoreState = () => useDashboardStore.getState();

export { dashboardLevelKey } from './initialState';
export { widgetTrendSource } from './projection';
export { dashboardSelectors } from './selectors';
export type { DashboardAction, DashboardRequest, DashboardStore } from './store';
export { useDashboardStore } from './store';
