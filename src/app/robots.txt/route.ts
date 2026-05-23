import { NextResponse } from 'next/server';
import { resolveRouteData } from 'next/dist/build/webpack/loaders/metadata/resolve-route-data';

import { Sitemap } from '@/server/sitemap';
import { getCanonicalUrl } from '@/server/utils/url';

export const revalidate = 86_400;

export async function GET() {
  const sitemapModule = new Sitemap();
  const data = {
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
    sitemap: sitemapModule.getRobots(),
  };

  const content = resolveRouteData(data, 'robots');

  return new NextResponse(content, {
    headers: {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Content-Type': 'text/plain',
    },
  });
}
