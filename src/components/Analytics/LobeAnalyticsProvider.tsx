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

type RequestIdleCallback = (callback: () => void, options?: { timeout?: number }) => number;

const scheduleIdle = (task: () => void) => {
  const requestIdleCallback = (
    window as typeof window & { requestIdleCallback?: RequestIdleCallback }
  ).requestIdleCallback;

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(task, { timeout: 3000 });
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
