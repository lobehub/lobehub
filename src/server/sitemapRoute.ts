import { connection } from 'next/server';

import { Sitemap, SITEMAP_REVALIDATE_SECONDS, SitemapType } from '@/server/sitemap';

const SITEMAP_BUILD_DIAGNOSTICS_ENABLED = process.env.LOBE_BUILD_DIAGNOSTICS === '1';

function logSitemapRouteStep(step: string, details?: unknown) {
  if (!SITEMAP_BUILD_DIAGNOSTICS_ENABLED) return;

  if (details !== undefined) {
    console.error(`[app:sitemap] ${step}`, details);
    return;
  }

  console.error(`[app:sitemap] ${step}`);
}

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

export async function resolveSitemap(id: string) {
  const startedAt = Date.now();
  logSitemapRouteStep('sitemap route start', { id });

  const { type, page } = parsePaginatedId(id);
  const sitemapModule = new Sitemap();

  let result;

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
      if (id.startsWith('plugins-')) {
        result = await sitemapModule.getPlugins(parseInt(id.split('-')[1], 10));
        break;
      }
      if (id.startsWith('assistants-')) {
        result = await sitemapModule.getAssistants(parseInt(id.split('-')[1], 10));
        break;
      }
      if (id.startsWith('models-')) {
        result = await sitemapModule.getModels(parseInt(id.split('-')[1], 10));
        break;
      }

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

export async function ensureRuntimeSitemapRequest() {
  // Prevent Next from prerendering the sitemap tree at build time under Turbopack.
  await connection();
}

export { SITEMAP_REVALIDATE_SECONDS };
