import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Whether dashboards — the widget / dashboard APIs and the `lobe-dashboard`
 * agent tool — are enabled for this user (runtime flag `dashboard`, off by
 * default). The scheduler is deliberately not gated: widgets already
 * published keep refreshing while the flag is off.
 */
export const isDashboardEnabled = async (userId?: string) =>
  (await getServerFeatureFlagsStateFromRuntimeConfig(userId)).enableDashboard === true;
