import { type ReactNode } from 'react';
import { memo } from 'react';

import { LobeAnalyticsProvider } from '@/components/Analytics/LobeAnalyticsProvider';
import type { SPAServerConfig } from '@/types/spaServerConfig';
import { isDev } from '@/utils/env';

type Props = {
  children: ReactNode;
};

export const LobeAnalyticsProviderWrapper = memo<Props>(({ children }) => {
  const serverConfig: SPAServerConfig | undefined = window.__SERVER_CONFIG__;
  const analytics = serverConfig?.analyticsConfig;

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
        host: analytics?.posthog?.host ?? '',
        key: analytics?.posthog?.key ?? '',
        person_profiles: 'always',
      }}
    >
      {children}
    </LobeAnalyticsProvider>
  );
});

LobeAnalyticsProviderWrapper.displayName = 'LobeAnalyticsProviderWrapper';
