import { type MetadataRoute } from 'next';

import { getCanonicalUrl } from '@/server/utils/url';

// Robots file cache configuration - revalidate every 24 hours
export const revalidate = 86_400; // 24 hours - content page cache
export const dynamic = 'force-static';

const robots = (): MetadataRoute.Robots => {
  return {
    host: getCanonicalUrl(),
    rules: [
      {
        allow: ['/community/*'],
        userAgent: ['Facebot', 'facebookexternalhit'],
      },
      {
        allow: ['/community/*'],
        userAgent: 'LinkedInBot',
      },
      {
        allow: ['/community/*'],
        userAgent: 'Twitterbot',
      },
      {
        allow: ['/'],
        // `/agent/*` also hosts Agent Share visitor pages (`/agent/:slugOrId`):
        // link-visible, creator-owned content that must never be indexed.
        disallow: ['/api/*', '/signin', '/signup', '/knowledge/*', '/share/*', '/agent/*'],
        userAgent: '*',
      },
    ],
  };
};

export default robots;
