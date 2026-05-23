import { NextResponse } from 'next/server';

import { Sitemap } from '@/server/sitemap';
import { ensureRuntimeSitemapRequest } from '@/server/sitemapRoute';

export const revalidate = 86_400;

export async function GET() {
  await ensureRuntimeSitemapRequest();

  const sitemapModule = new Sitemap();
  const content = await sitemapModule.getIndex();

  return new NextResponse(content, {
    headers: {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Content-Type': 'application/xml',
    },
  });
}
