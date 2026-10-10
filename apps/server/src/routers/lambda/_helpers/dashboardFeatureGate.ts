import { TRPCError } from '@trpc/server';

import { isDashboardEnabled } from '@/server/services/widget/featureGate';

/** Refuse every widget / dashboard call while the `dashboard` flag is off for the caller. */
export const assertDashboardEnabled = async (userId: string) => {
  if (!(await isDashboardEnabled(userId))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Dashboards are not enabled for this account',
    });
  }
};
