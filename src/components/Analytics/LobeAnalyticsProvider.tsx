'use client';

import {
  type GoogleAnalyticsProviderConfig,
  type PostHogProviderAnalyticsConfig,
  type XAdsProviderAnalyticsConfig,
} from '@lobehub/analytics';
import { createSingletonAnalytics } from '@lobehub/analytics';
import { AnalyticsProvider } from '@lobehub/analytics/react';
import { type ReactNode } from 'react';
import { memo, useRef } from 'react';

import { BUSINESS_LINE } from '@/const/analytics';
import { isDesktop } from '@/const/version';
import { isDev } from '@/utils/env';

type Props = {
  children: ReactNode;
  ga4Config: GoogleAnalyticsProviderConfig;
  postHogConfig: PostHogProviderAnalyticsConfig;
  xAdsConfig: XAdsProviderAnalyticsConfig;
};

let analyticsInstance: ReturnType<typeof createSingletonAnalytics> | null = null;

export const LobeAnalyticsProvider = memo(
  ({ children, ga4Config, postHogConfig, xAdsConfig }: Props) => {
    const analyticsRef = useRef<ReturnType<typeof createSingletonAnalytics> | null>(null);

    if (!analyticsRef.current) {
      analyticsRef.current =
        analyticsInstance ||
        createSingletonAnalytics({
          business: BUSINESS_LINE,
          debug: isDev,
          providers: {
            ga4: ga4Config,
            posthog: postHogConfig,
            xAds: xAdsConfig,
          },
        });

      analyticsInstance = analyticsRef.current;
    }

    const analytics = analyticsRef.current;

    if (!analytics) return children;

    return (
      <AnalyticsProvider
        client={analytics}
        onInitializeSuccess={() => {
          analyticsInstance?.setGlobalContext({
            platform: isDesktop ? 'desktop' : 'web',
          });

          analyticsInstance
            ?.getProvider('posthog')
            ?.getNativeInstance()
            ?.register({
              platform: isDesktop ? 'desktop' : 'web',
            });
        }}
      >
        {children}
      </AnalyticsProvider>
    );
  },
  () => true,
);
