import { NextResponse } from 'next/server';
import { resolveRouteData } from 'next/dist/build/webpack/loaders/metadata/resolve-route-data';

import {
  ensureRuntimeSitemapRequest,
  resolveSitemap,
  SITEMAP_REVALIDATE_SECONDS,
} from '@/server/sitemapRoute';

export const revalidate = SITEMAP_REVALIDATE_SECONDS;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureRuntimeSitemapRequest();

  const { id } = await params;
  const data = await resolveSitemap(id);
  const content = resolveRouteData(data, 'sitemap');

  return new NextResponse(content, {
    headers: {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Content-Type': 'application/xml',
    },
  });
}
