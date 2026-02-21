'use client';

import Script from 'next/script';
import { memo } from 'react';
import urlJoin from 'url-join';

const DesktopAnalytics = memo(
  () =>
    process.env.NEXT_PUBLIC_DESKTOP_PROJECT_ID &&
    process.env.NEXT_PUBLIC_DESKTOP_UMAMI_BASE_URL && (
      <Script
        defer
        data-website-id={process.env.NEXT_PUBLIC_DESKTOP_PROJECT_ID}
        src={urlJoin(process.env.NEXT_PUBLIC_DESKTOP_UMAMI_BASE_URL, 'script.js')}
      />
    ),
);

export default DesktopAnalytics;
