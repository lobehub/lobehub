'use client';

import type {
  GoogleAnalyticsProviderConfig,
  PostHogProviderAnalyticsConfig,
  XAdsProviderAnalyticsConfig,
} from '@lobehub/analytics';
import { createSingletonAnalytics } from '@lobehub/analytics';
import { AnalyticsProvider } from '@lobehub/analytics/react';
import type { ReactNode } from 'react';
import { memo, useEffect, useRef, useState } from 'react';

import { BUSINESS_LINE } from '@/const/analytics';
import { isDesktop } from '@/const/version';

type Props = {
  captureEnabled: boolean;
  children: ReactNode;
  ga4Config: GoogleAnalyticsProviderConfig;
  postHogConfig: PostHogProviderAnalyticsConfig;
  xAdsConfig: XAdsProviderAnalyticsConfig;
};

let analyticsInstance: ReturnType<typeof createSingletonAnalytics> | null = null;

export const LobeAnalyticsProvider = memo(
  ({ captureEnabled, children, ga4Config, postHogConfig, xAdsConfig }: Props) => {
    const analyticsRef = useRef<ReturnType<typeof createSingletonAnalytics> | null>(null);
    const previousCaptureEnabledRef = useRef(captureEnabled);
    const [isCaptureReady, setIsCaptureReady] = useState(false);

    if (!analyticsRef.current) {
      analyticsRef.current =
        analyticsInstance ||
        createSingletonAnalytics({
          business: BUSINESS_LINE,
          // Keep every provider opted out until legacy identity cleanup finishes.
          captureEnabled: false,
          // Keep the manager-level logs (`[AnalyticsManager] ...`) quiet even in dev
          debug: false,
          providers: {
            ga4: ga4Config,
            posthog: postHogConfig,
            xAds: xAdsConfig,
          },
        });

      analyticsInstance = analyticsRef.current;
    }

    const analytics = analyticsRef.current;

    useEffect(() => {
      if (!analytics || !isCaptureReady) {
        previousCaptureEnabledRef.current = captureEnabled;
        return;
      }

      const wasCaptureEnabled = previousCaptureEnabledRef.current;
      previousCaptureEnabledRef.current = captureEnabled;

      if (wasCaptureEnabled && !captureEnabled) {
        // opt-out stops new events; reset also clears identity already loaded in provider memory.
        void analytics.reset();
        return;
      }

      if (!captureEnabled) return;

      // Privacy boundary: telemetry consent covers anonymous product-usage metrics only.
      // Never call `identify` or attach account/profile fields here, even after consent.
      // The shared manager fans identification out to every configured provider, including GA4.
      analytics
        .getProvider('posthog')
        ?.getNativeInstance()
        ?.register({
          platform: isDesktop ? 'desktop' : 'web',
        });
    }, [analytics, captureEnabled, isCaptureReady]);

    if (!analytics) return children;

    return (
      <AnalyticsProvider
        captureEnabled={isCaptureReady && captureEnabled}
        client={analytics}
        onInitializeSuccess={() => {
          const finishPrivacyInitialization = async () => {
            const postHog = analytics.getProvider('posthog')?.getNativeInstance();
            const hasLegacyIdentity =
              !!postHog?.get_property('$user_id') ||
              postHog?.get_property('$user_state') === 'identified';

            // Previous releases identified signed-in accounts. Clear that persisted identity
            // before allowing the first anonymous product-usage event after this upgrade.
            if (hasLegacyIdentity) await analytics.reset();

            analytics.setGlobalContext({
              platform: isDesktop ? 'desktop' : 'web',
            });
            setIsCaptureReady(true);
          };

          void finishPrivacyInitialization();
        }}
      >
        {children}
      </AnalyticsProvider>
    );
  },
);
