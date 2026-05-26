import { type MetadataRoute } from 'next';

import { LAST_MODIFIED, Sitemap, SitemapType } from '@/server/sitemap';

// Sitemap cache configuration - revalidate every 24 hours
export const revalidate = 86_400; // 24 hours - content page cache
export const dynamic = 'force-static';

export const generateSitemapLink = (url: string) =>
  ['<sitemap>', `<loc>${url}</loc>`, `<lastmod>${LAST_MODIFIED}</lastmod>`, '</sitemap>'].join(
    '\n',
  );

export async function generateSitemaps() {
  const sitemapModule = new Sitemap();
  // Generate dynamic sitemap list, including paginated sitemaps
  const sitemapIds = [...sitemapModule.sitemapIndexs];

  // Get page counts for types that need pagination
  const [pluginPages, assistantPages, modelPages] = await Promise.all([
    sitemapModule.getPluginPageCount(),
    sitemapModule.getAssistantPageCount(),
    sitemapModule.getModelPageCount(),
  ]);

  for (let i = 0; i < pluginPages; i += 1) {
    sitemapIds.push({ id: `plugins-${i + 1}` as SitemapType });
  }

  for (let i = 0; i < assistantPages; i += 1) {
    sitemapIds.push({ id: `assistants-${i + 1}` as SitemapType });
  }

  for (let i = 0; i < modelPages; i += 1) {
    sitemapIds.push({ id: `models-${i + 1}` as SitemapType });
  }

  return sitemapIds;
}

// Parse paginated ID
export function parsePaginatedId(id: string): { page?: number; type: SitemapType } {
  if (id.includes('-')) {
    const [type, pageStr] = id.split('-');
    const page = parseInt(pageStr, 10);
    if (!isNaN(page)) {
      return { page, type: type as SitemapType };
    }
  }
  return { type: id as SitemapType };
}

export default async function sitemap({
  id: idPromise,
}: {
  id: string;
}): Promise<MetadataRoute.Sitemap> {
  const id = await idPromise;

  const { type, page } = parsePaginatedId(id);
  const sitemapModule = new Sitemap();

  switch (type) {
    case SitemapType.Pages: {
      return sitemapModule.getPage();
    }
    case SitemapType.Assistants: {
      return sitemapModule.getAssistants(page);
    }
    case SitemapType.Plugins: {
      return sitemapModule.getPlugins(page);
    }
    case SitemapType.Models: {
      return sitemapModule.getModels(page);
    }
    case SitemapType.Providers: {
      return sitemapModule.getProviders();
    }
    default: {
      // Handle paginated sitemaps (plugins-1, assistants-2, mcp-3, etc.)
      if (id.startsWith('plugins-')) {
        const pageNum = parseInt(id.split('-')[1], 10);
        return sitemapModule.getPlugins(pageNum);
      }
      if (id.startsWith('assistants-')) {
        const pageNum = parseInt(id.split('-')[1], 10);
        return sitemapModule.getAssistants(pageNum);
      }
      if (id.startsWith('models-')) {
        const pageNum = parseInt(id.split('-')[1], 10);
        return sitemapModule.getModels(pageNum);
      }

      // Default to empty array
      return [];
    }
  }
}
