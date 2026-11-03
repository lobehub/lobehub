'use client';

import { memo, useEffect } from 'react';

interface GoogleAnalyticsProps {
  gaId?: string;
}

const GoogleAnalytics = memo<GoogleAnalyticsProps>(({ gaId }) => {
  useEffect(() => {
    if (!gaId) return;

    const script = document.createElement('script');
    script.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
    script.async = true;
    document.head.appendChild(script);

    (window as any).dataLayer = (window as any).dataLayer || [];
    function gtag(...args: any[]) {
      (window as any).dataLayer.push(args);
    }
    gtag('js', new Date());
    gtag('config', gaId);
  }, [gaId]);

  return null;
});

export default GoogleAnalytics;
