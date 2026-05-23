import type { AnalyticsEvent, AnalyticsManager } from '@lobehub/analytics';
import { getSingletonAnalyticsOptional } from '@lobehub/analytics';

import { getUserStoreState } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

interface TrackProductUsageEventOptions {
  analytics?: AnalyticsManager | null;
}

export const isProductUsageEventEnabled = () =>
  Boolean(userGeneralSettingsSelectors.telemetry(getUserStoreState()));

export const trackProductUsageEvent = async (
  event: AnalyticsEvent,
  options: TrackProductUsageEventOptions = {},
) => {
  if (!isProductUsageEventEnabled()) return false;

  const analytics = options.analytics ?? getSingletonAnalyticsOptional();
  if (!analytics) return false;

  try {
    const status = analytics.getStatus();
    if (!status.initialized) return false;

    await analytics.track(event);
    return true;
  } catch (error) {
    console.error('Failed to track product usage event:', error);
    return false;
  }
};
