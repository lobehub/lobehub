'use client';

import type { AnalyticsManager } from '@lobehub/analytics';
import { memo, useEffect, useRef } from 'react';

import { BUSINESS_LINE } from '@/const/analytics';
import { isDev } from '@/utils/env';

interface XAdsProps {
  eventIds?: Record<string, string | undefined>;
  pixelId?: string;
  purchaseEventId?: string;
}

const XAds = memo<XAdsProps>(({ eventIds, pixelId, purchaseEventId }) => {
  const analyticsRef = useRef<AnalyticsManager | null>(null);

  useEffect(() => {
    let cancelled = false;

    void import('@lobehub/analytics').then(({ createAnalytics, getSingletonAnalyticsOptional }) => {
      if (cancelled || getSingletonAnalyticsOptional()?.getProvider('xAds')) return;

      if (!analyticsRef.current) {
        analyticsRef.current = createAnalytics({
          business: BUSINESS_LINE,
          debug: isDev,
          providers: {
            xAds: {
              debug: isDev,
              eventIds,
              enabled: !!pixelId,
              pixelId: pixelId ?? '',
              purchaseEventId,
            },
          },
        });
      }

      analyticsRef.current.initialize().catch((error) => {
        console.error('[X Ads Bootstrap] Initialization failed:', error);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [eventIds, pixelId, purchaseEventId]);

  return null;
});

export default XAds;
