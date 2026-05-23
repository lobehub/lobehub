// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { Sitemap, SitemapType } from '@/server/sitemap';

import { parsePaginatedId, resolveSitemap } from './sitemapRoute';

describe('sitemapRoute', () => {
  it('should parse paginated sitemap ids', () => {
    expect(parsePaginatedId('models-2')).toEqual({ page: 2, type: SitemapType.Models });
    expect(parsePaginatedId('providers')).toEqual({ type: SitemapType.Providers });
  });

  it('should resolve paginated sitemap data via the shared sitemap service', async () => {
    const getModels = vi
      .spyOn(Sitemap.prototype, 'getModels')
      .mockResolvedValue([{ url: 'https://lobechat.com/community/model/test' }] as any);

    await expect(resolveSitemap('models-2')).resolves.toEqual([
      { url: 'https://lobechat.com/community/model/test' },
    ]);
    expect(getModels).toHaveBeenCalledWith(2);
  });

  it('should resolve static sitemap ids via the shared sitemap service', async () => {
    const getProviders = vi
      .spyOn(Sitemap.prototype, 'getProviders')
      .mockResolvedValue([{ url: 'https://lobechat.com/community/provider/test' }] as any);

    await expect(resolveSitemap('providers')).resolves.toEqual([
      { url: 'https://lobechat.com/community/provider/test' },
    ]);
    expect(getProviders).toHaveBeenCalledOnce();
  });
});
