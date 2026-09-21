import { type ReactNode } from 'react';
import { memo } from 'react';

import { LobeAnalyticsProvider } from '@/components/Analytics/LobeAnalyticsProvider';
import type { AnalyticsConfig, SPAServerConfig } from '@/types/spaServerConfig';
import { isDev } from '@/utils/env';

type Props = {
  analytics?: AnalyticsConfig;
  children: ReactNode;
};

const readInjectedAnalytics = (): AnalyticsConfig | undefined => {
  if (typeof window === 'undefined') return undefined;

  return (window.__SERVER_CONFIG__ as SPAServerConfig | undefined)?.analyticsConfig;
};

export const LobeAnalyticsProviderWrapper = memo<Props>(
  ({ analytics: analyticsProp, children }) => {
    const analytics = analyticsProp ?? readInjectedAnalytics();

    return (
      <LobeAnalyticsProvider
        ga4Config={{
          debug: isDev,
          enabled: !!analytics?.google?.measurementId,
          gtagConfig: {
            debug_mode: isDev,
          },
          measurementId: analytics?.google?.measurementId ?? '',
        }}
        postHogConfig={{
          debug: analytics?.posthog?.debug ?? false,
          enabled: !!analytics?.posthog?.key,
          capture_pageview: 'history_change',
          host: analytics?.posthog?.host ?? '',
          key: analytics?.posthog?.key ?? '',
          person_profiles: 'always',
        }}
        xAdsConfig={{
          debug: isDev,
          eventIds: analytics?.xAds?.eventIds,
          enabled: !!analytics?.xAds?.pixelId,
          pixelId: analytics?.xAds?.pixelId ?? '',
          purchaseEventId: analytics?.xAds?.purchaseEventId,
        }}
      >
        {children}
      </LobeAnalyticsProvider>
    );
  },
);

LobeAnalyticsProviderWrapper.displayName = 'LobeAnalyticsProviderWrapper';
