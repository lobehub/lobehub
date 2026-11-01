'use client';

import type {
  GoogleAnalyticsProviderConfig,
  PostHogProviderAnalyticsConfig,
  XAdsProviderAnalyticsConfig,
} from '@lobehub/analytics';
import { type ReactNode } from 'react';
import { memo, useEffect } from 'react';

import { loadAnalytics } from '@/libs/analytics/client';

type Props = {
  children: ReactNode;
  ga4Config: GoogleAnalyticsProviderConfig;
  postHogConfig: PostHogProviderAnalyticsConfig;
  xAdsConfig: XAdsProviderAnalyticsConfig;
};

const scheduleIdle = (task: () => void) => {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task, { timeout: 3000 });
    return;
  }

  window.setTimeout(task, 0);
};

export const LobeAnalyticsProvider = memo(
  ({ children, ga4Config, postHogConfig, xAdsConfig }: Props) => {
    useEffect(() => {
      scheduleIdle(() => {
        void loadAnalytics({ ga4: ga4Config, posthog: postHogConfig, xAds: xAdsConfig });
      });
    }, [ga4Config, postHogConfig, xAdsConfig]);

    return children;
  },
  () => true,
);
