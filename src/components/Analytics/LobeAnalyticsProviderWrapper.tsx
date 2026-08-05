import type { ReactNode } from 'react';
import { memo } from 'react';

import { LobeAnalyticsProvider } from '@/components/Analytics/LobeAnalyticsProvider';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import type { SPAServerConfig } from '@/types/spaServerConfig';
import { isDev } from '@/utils/env';

type Props = {
  children: ReactNode;
};

export const LobeAnalyticsProviderWrapper = memo<Props>(({ children }) => {
  const serverConfig: SPAServerConfig | undefined = window.__SERVER_CONFIG__;
  const analytics = serverConfig?.analyticsConfig;
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const telemetryEnabled = useUserStore(userGeneralSettingsSelectors.telemetry);
  const captureEnabled = isUserStateInit && telemetryEnabled === true;

  return (
    <LobeAnalyticsProvider
      captureEnabled={captureEnabled}
      ga4Config={{
        debug: isDev,
        enabled: !!analytics?.google?.measurementId,
        gtagConfig: {
          debug_mode: isDev,
        },
        measurementId: analytics?.google?.measurementId ?? '',
      }}
      postHogConfig={{
        // Privacy boundary: allow only explicitly coded, anonymous product events. posthog-js
        // otherwise decorates events with the current URL/referrer and page title, which can
        // contain private Agent/topic IDs or user-authored names even after telemetry consent.
        autocapture: false,
        capture_pageleave: false,
        capture_pageview: false,
        debug: analytics?.posthog?.debug ?? false,
        disable_session_recording: true,
        enabled: !!analytics?.posthog?.key,
        host: analytics?.posthog?.host ?? '',
        key: analytics?.posthog?.key ?? '',
        mask_all_element_attributes: true,
        mask_all_text: true,
        mask_personal_data_properties: true,
        opt_out_capturing_by_default: true,
        opt_out_persistence_by_default: true,
        person_profiles: 'never',
        property_denylist: [
          '$current_url',
          '$host',
          '$initial_current_url',
          '$initial_host',
          '$initial_pathname',
          '$initial_ph_keyword',
          '$initial_referrer',
          '$initial_referring_domain',
          '$initial_search_engine',
          '$pathname',
          '$referrer',
          '$referring_domain',
          '$search_engine',
          'ph_keyword',
          'title',
        ],
        save_campaign_params: false,
        save_referrer: false,
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
});

LobeAnalyticsProviderWrapper.displayName = 'LobeAnalyticsProviderWrapper';
