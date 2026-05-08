import type { ReactNode } from 'react';

import { LobeAnalyticsProvider } from '@/components/Analytics/LobeAnalyticsProvider';
import { analyticsEnv } from '@/envs/analytics';
import { isDev } from '@/utils/env';

interface AnalyticsRSCProviderProps {
  children: ReactNode;
}

const AnalyticsRSCProvider = ({ children }: AnalyticsRSCProviderProps) => {
  return (
    <LobeAnalyticsProvider
      ga4Config={{
        debug: isDev,
        enabled: !!analyticsEnv.GOOGLE_ANALYTICS_MEASUREMENT_ID,
        gtagConfig: {
          debug_mode: isDev,
        },
        measurementId: analyticsEnv.GOOGLE_ANALYTICS_MEASUREMENT_ID ?? '',
      }}
      postHogConfig={{
        debug: analyticsEnv.DEBUG_POSTHOG_ANALYTICS,
        enabled: analyticsEnv.ENABLED_POSTHOG_ANALYTICS,
        host: analyticsEnv.POSTHOG_HOST,
        key: analyticsEnv.POSTHOG_KEY ?? '',
        person_profiles: 'always',
      }}
      xAdsConfig={{
        debug: isDev,
        eventIds: {
          login_or_signup_clicked: analyticsEnv.X_ADS_LOGIN_OR_SIGNUP_CLICKED_EVENT_ID,
          main_page_view: analyticsEnv.X_ADS_MAIN_PAGE_VIEW_EVENT_ID,
        },
        enabled: analyticsEnv.ENABLED_X_ADS,
        pixelId: analyticsEnv.X_ADS_PIXEL_ID ?? '',
        purchaseEventId: analyticsEnv.X_ADS_PURCHASE_EVENT_ID,
      }}
    >
      {children}
    </LobeAnalyticsProvider>
  );
};

export default AnalyticsRSCProvider;
