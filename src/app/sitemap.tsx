import { type MetadataRoute } from 'next';

import { LAST_MODIFIED, Sitemap, SitemapType } from '@/server/sitemap';

// Sitemap缓存配置 - 24小时重新验证
export const revalidate = 86_400; // 24小时 - 内容页面缓存
export const dynamic = 'force-static';

export const generateSitemapLink = (url: string) =>
  ['<sitemap>', `<loc>${url}</loc>`, `<lastmod>${LAST_MODIFIED}</lastmod>`, '</sitemap>'].join(
    '\n',
  );

export async function generateSitemaps() {
  const sitemapModule = new Sitemap();
  // 生成动态的sitemap列表，包括分页的sitemap
  const staticSitemaps = sitemapModule.sitemapIndexs;

  // 获取需要分页的类型的页数
  const [pluginPages, assistantPages, modelPages] = await Promise.all([
    sitemapModule.getPluginPageCount(),
    sitemapModule.getAssistantPageCount(),
    sitemapModule.getModelPageCount(),
  ]);

  // 生成分页sitemap ID列表
  const paginatedSitemaps = [
    ...Array.from({ length: pluginPages }, (_, i) => ({ id: `plugins-${i + 1}` as SitemapType })),
    ...Array.from({ length: assistantPages }, (_, i) => ({
      id: `assistants-${i + 1}` as SitemapType,
    })),
    ...Array.from({ length: modelPages }, (_, i) => ({ id: `models-${i + 1}` as SitemapType })),
  ];

  return [...staticSitemaps, ...paginatedSitemaps];
}

// 解析分页ID
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
      // 处理分页的sitemap（plugins-1, assistants-2, mcp-3等）
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

      // 默认返回空数组
      return [];
    }
  }
}
