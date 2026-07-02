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
        disallow: ['/api/*', '/signin', '/signup', '/knowledge/*', '/share/*'],
        userAgent: '*',
      },
    ],
  };
};

export default robots;
