'use client';

import { useAnalytics } from '@lobehub/analytics/react';
import { memo, useEffect } from 'react';

import { setOnboardingAnalyticsClient } from '@/services/onboardingMetrics';

const AnalyticsBridge = memo(() => {
  const { analytics } = useAnalytics();

  useEffect(() => {
    setOnboardingAnalyticsClient(analytics ?? null);
    return () => setOnboardingAnalyticsClient(null);
  }, [analytics]);

  return null;
});

AnalyticsBridge.displayName = 'AgentOnboardingAnalyticsBridge';

export default AnalyticsBridge;
