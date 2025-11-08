import { MetadataRoute } from 'next';

import { Sitemap } from '@/server/sitemap';
import { getCanonicalUrl } from '@/server/utils/url';

// Robots文件缓存配置 - 24小时重新验证
export const revalidate = 86_400; // 24小时 - 内容页面缓存
export const dynamic = 'force-static';

const robots = (): MetadataRoute.Robots => {
  const sitemapModule = new Sitemap();
  return {
    host: getCanonicalUrl(),
    rules: [
      {
        allow: ['/discover/*'],
        userAgent: ['Facebot', 'facebookexternalhit'],
      },
      {
        allow: ['/discover/*'],
        userAgent: 'LinkedInBot',
      },
      {
        allow: ['/discover/*'],
        userAgent: 'Twitterbot',
      },
      {
        allow: ['/'],
        disallow: ['/api/*', '/login', '/signup', '/knowledge/*'],
        userAgent: '*',
      },
    ],
    sitemap: sitemapModule.getRobots(),
  };
};

export default robots;
