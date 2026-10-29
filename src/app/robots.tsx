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
        // Shared links stay out of search results through the `noindex` directive the share
        // document and response header carry. A crawler can only read that directive while it may
        // fetch the URL, so the three real share routes are allowed on top of the `/share/*`
        // block. Everything else under `/share/` keeps the block: the SPA fallback answers those
        // paths with the indexable app shell.
        allow: ['/', '/share/t/', '/share/page/', '/share/artifact/'],
        // `/a/*` is the Agent Share visitor page: link-visible, creator-owned
        // content that must never be indexed. `/agent/*` is the creator's own
        // agent pages (and still forwards legacy share links).
        disallow: ['/api/*', '/signin', '/signup', '/knowledge/*', '/share/*', '/agent/*', '/a/*'],
        userAgent: '*',
      },
    ],
  };
};

export default robots;
