import { type MetadataRoute } from 'next';

import { LAST_MODIFIED, SITEMAP_REVALIDATE_SECONDS, Sitemap, SitemapType } from '@/server/sitemap';

// Sitemap cache configuration - revalidate every 24 hours
export const revalidate = SITEMAP_REVALIDATE_SECONDS;
export const dynamic = 'force-static';
const SITEMAP_BUILD_DIAGNOSTICS_ENABLED = process.env.LOBE_BUILD_DIAGNOSTICS === '1';

export const generateSitemapLink = (url: string) =>
  ['<sitemap>', `<loc>${url}</loc>`, `<lastmod>${LAST_MODIFIED}</lastmod>`, '</sitemap>'].join(
    '\n',
  );

function logSitemapRouteStep(step: string, details?: unknown) {
  if (!SITEMAP_BUILD_DIAGNOSTICS_ENABLED) return;

  if (details !== undefined) {
    console.error(`[app:sitemap] ${step}`, details);
    return;
  }

  console.error(`[app:sitemap] ${step}`);
}

export async function generateSitemaps() {
  const startedAt = Date.now();
  logSitemapRouteStep('generateSitemaps start');
  const sitemapModule = new Sitemap();
  // Generate dynamic sitemap list, including paginated sitemaps
  const staticSitemaps = sitemapModule.sitemapIndexs;

  // Get page counts for types that need pagination
  const [pluginPages, assistantPages, modelPages] = await Promise.all([
    sitemapModule.getPluginPageCount(),
    sitemapModule.getAssistantPageCount(),
    sitemapModule.getModelPageCount(),
  ]);

  // Generate paginated sitemap ID list
  const paginatedSitemaps = [
    ...Array.from({ length: pluginPages }, (_, i) => ({ id: `plugins-${i + 1}` as SitemapType })),
    ...Array.from({ length: assistantPages }, (_, i) => ({
      id: `assistants-${i + 1}` as SitemapType,
    })),
    ...Array.from({ length: modelPages }, (_, i) => ({ id: `models-${i + 1}` as SitemapType })),
  ];

  const result = [...staticSitemaps, ...paginatedSitemaps];
  logSitemapRouteStep('generateSitemaps complete', {
    assistantPages,
    durationMs: Date.now() - startedAt,
    modelPages,
    pluginPages,
    sitemapCount: result.length,
  });

  return result;
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
  const startedAt = Date.now();
  logSitemapRouteStep('sitemap route start', { id });

  const { type, page } = parsePaginatedId(id);
  const sitemapModule = new Sitemap();

  let result: MetadataRoute.Sitemap;

  switch (type) {
    case SitemapType.Pages: {
      result = await sitemapModule.getPage();
      break;
    }
    case SitemapType.Assistants: {
      result = await sitemapModule.getAssistants(page);
      break;
    }
    case SitemapType.Plugins: {
      result = await sitemapModule.getPlugins(page);
      break;
    }
    case SitemapType.Models: {
      result = await sitemapModule.getModels(page);
      break;
    }
    case SitemapType.Providers: {
      result = await sitemapModule.getProviders();
      break;
    }
    default: {
      // Handle paginated sitemaps (plugins-1, assistants-2, mcp-3, etc.)
      if (id.startsWith('plugins-')) {
        const pageNum = parseInt(id.split('-')[1], 10);
        result = await sitemapModule.getPlugins(pageNum);
        break;
      }
      if (id.startsWith('assistants-')) {
        const pageNum = parseInt(id.split('-')[1], 10);
        result = await sitemapModule.getAssistants(pageNum);
        break;
      }
      if (id.startsWith('models-')) {
        const pageNum = parseInt(id.split('-')[1], 10);
        result = await sitemapModule.getModels(pageNum);
        break;
      }

      // Default to empty array
      result = [];
    }
  }

  logSitemapRouteStep('sitemap route complete', {
    durationMs: Date.now() - startedAt,
    id,
    items: result.length,
  });

  return result;
}
