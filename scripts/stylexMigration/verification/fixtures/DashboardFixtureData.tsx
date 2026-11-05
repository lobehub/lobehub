import type { ReactNode } from 'react';

const notExercised = async () => {
  throw new Error('BUSINESS_MUTATION_OUTSIDE_STYLE_FIXTURE');
};

const dashboardState = { saveDashboardLayout: notExercised };
export const useDashboardStore = <T,>(selector: (state: typeof dashboardState) => T): T =>
  selector(dashboardState);
export const dashboardSelectors = { isLayoutSaving: () => () => false };

const userState = { userId: 'fixture-user' };
export const useUserStore = <T,>(selector: (state: typeof userState) => T): T =>
  selector(userState);
export const userProfileSelectors = { userId: (state: typeof userState) => state.userId };

export const openWidgetEditModal = notExercised;

const WidgetCardStandIn = ({
  className,
  handle,
  title,
}: {
  className?: string;
  handle?: ReactNode;
  title?: ReactNode;
}) => (
  <div className={className} style={{ display: 'flex', gap: 8, height: '100%', padding: 12 }}>
    {handle}
    {title}
  </div>
);
export default WidgetCardStandIn;
