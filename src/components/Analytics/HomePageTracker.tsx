'use client';

import { useAnalytics } from '@lobehub/analytics/react';
import { memo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const HomePageTracker = memo(() => {
  const { analytics } = useAnalytics();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!analytics || pathname !== '/') return;

    const timer = setTimeout(() => {
      analytics.track({
        name: 'main_page_view',
        properties: {
          spm: 'homepage.main_page.view',
        },
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [analytics, pathname]);

  return null;
});

HomePageTracker.displayName = 'HomePageTracker';

export default HomePageTracker;
