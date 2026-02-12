import { type ReactNode } from 'react';
import { memo } from 'react';

import { LobeAnalyticsProvider } from '@/components/Analytics/LobeAnalyticsProvider';
import { analyticsEnv } from '@/envs/analytics';
import { isDev } from '@/utils/env';

type Props = {
  children: ReactNode;
};

export const LobeAnalyticsProviderWrapper = memo<Props>(({ children }) => {
  return (
    <LobeAnalyticsProvider
      ga4Config={{
        debug: isDev,
        enabled: analyticsEnv.ENABLE_GOOGLE_ANALYTICS,
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
    >
      {children}
    </LobeAnalyticsProvider>
  );
});

LobeAnalyticsProviderWrapper.displayName = 'LobeAnalyticsProviderWrapper';
