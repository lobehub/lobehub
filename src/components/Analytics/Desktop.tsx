'use client';

import { memo, useEffect } from 'react';
import urlJoin from 'url-join';

const DesktopAnalytics = memo(() => {
  const projectId = process.env.NEXT_PUBLIC_DESKTOP_PROJECT_ID;
  const baseUrl = process.env.NEXT_PUBLIC_DESKTOP_UMAMI_BASE_URL;

  useEffect(() => {
    if (!projectId || !baseUrl) return;

    const script = document.createElement('script');
    script.src = urlJoin(baseUrl, 'script.js');
    script.defer = true;
    script.dataset.websiteId = projectId;
    document.head.appendChild(script);
  }, [projectId, baseUrl]);

  return null;
});

export default DesktopAnalytics;
