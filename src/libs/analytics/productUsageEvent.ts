import type { AnalyticsEvent, AnalyticsManager } from '@lobehub/analytics';

import { analyticsClient } from '@/libs/analytics/client';
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

  try {
    if (options.analytics) {
      if (!options.analytics.getStatus().initialized) return false;
      await options.analytics.track(event);
    } else {
      await analyticsClient.track(event);
    }
    return true;
  } catch (error) {
    console.error('Failed to track product usage event:', error);
    return false;
  }
};
