import { flatten } from 'es-toolkit/compat';
import { type MetadataRoute } from 'next';
import qs from 'query-string';
import urlJoin from 'url-join';

import { serverFeatureFlags } from '@/config/featureFlags';
import { DEFAULT_LANG } from '@/const/locale';
import { SITEMAP_BASE_URL } from '@/const/url';
import { type Locales, locales as allLocales } from '@/locales/resources';
import { DiscoverService } from '@/server/services/discover';
import { getCanonicalUrl } from '@/server/utils/url';
import { isDev } from '@/utils/env';

export interface SitemapItem {
  alternates?: {
    languages?: string;
  };
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  lastModified?: string | Date;
  priority?: number;
  url: string;
}

export enum SitemapType {
  Assistants = 'assistants',
  Mcp = 'mcp',
  Models = 'models',
  Pages = 'pages',
  Plugins = 'plugins',
  Providers = 'providers',
}

export const LAST_MODIFIED = new Date().toISOString();

// Number of items per page
const ITEMS_PER_PAGE = 100;

export class Sitemap {
  sitemapIndexs = [{ id: SitemapType.Pages }, { id: SitemapType.Providers }];

  private discoverService = new DiscoverService();

  // Get total number of plugin pages
  async getPluginPageCount(): Promise<number> {
    const list = await this.discoverService.getPluginIdentifiers();
    return Math.ceil(list.length / ITEMS_PER_PAGE);
  }

  // Get total number of assistant pages
  async getAssistantPageCount(): Promise<number> {
    const list = await this.discoverService.getAssistantIdentifiers();
    return Math.ceil(list.length / ITEMS_PER_PAGE);
  }

  // Get total number of model pages
  async getModelPageCount(): Promise<number> {
    const list = await this.discoverService.getModelIdentifiers();
    return Math.ceil(list.length / ITEMS_PER_PAGE);
  }

  private _generateSitemapLink(url: string) {
    return [
      '<sitemap>',
      `<loc>${url}</loc>`,
      `<lastmod>${LAST_MODIFIED}</lastmod>`,
      '</sitemap>',
    ].join('\n');
  }

  private _formatTime(time?: string) {
    try {
      if (!time) return LAST_MODIFIED;
      return new Date(time).toISOString() || LAST_MODIFIED;
    } catch {
      return LAST_MODIFIED;
    }
  }

  private _genSitemapItem = (
    lang: Locales,
    url: string,
    {
      lastModified,
      changeFrequency = 'monthly',
      priority = 0.4,
      noLocales,
      locales = allLocales,
    }: {
      changeFrequency?: SitemapItem['changeFrequency'];
      lastModified?: string;
      locales?: typeof allLocales;
      noLocales?: boolean;
      priority?: number;
    } = {},
  ) => {
    const sitemap = {
      changeFrequency,
      lastModified: this._formatTime(lastModified),
      priority,
      url:
        lang === DEFAULT_LANG
          ? getCanonicalUrl(url)
          : qs.stringifyUrl({ query: { hl: lang }, url: getCanonicalUrl(url) }),
    };
    if (noLocales) return sitemap;

    const languages: any = {};
    for (const locale of locales) {
      if (locale === lang) continue;
      languages[locale] = qs.stringifyUrl({
        query: { hl: locale },
        url: getCanonicalUrl(url),
      });
    }
    return {
      alternates: {
        languages,
      },
      ...sitemap,
    };
  };

  private _genSitemap(
    url: string,
    {
      lastModified,
      changeFrequency = 'monthly',
      priority = 0.4,
      noLocales,
      locales = allLocales,
    }: {
      changeFrequency?: SitemapItem['changeFrequency'];
      lastModified?: string;
      locales?: typeof allLocales;
      noLocales?: boolean;
      priority?: number;
    } = {},
  ) {
    if (noLocales)
      return [
        this._genSitemapItem(DEFAULT_LANG, url, {
          changeFrequency,
          lastModified,
          locales,
          noLocales,
          priority,
        }),
      ];
    return locales.map((lang) =>
      this._genSitemapItem(lang, url, {
        changeFrequency,
        lastModified,
        locales,
        noLocales,
        priority,
      }),
    );
  }

  async getIndex(): Promise<string> {
    const staticSitemaps = this.sitemapIndexs.map((item) =>
      this._generateSitemapLink(
        getCanonicalUrl(SITEMAP_BASE_URL, isDev ? item.id : `${item.id}.xml`),
      ),
    );

    // Get page counts for types that need pagination
    const [pluginPages, assistantPages, modelPages] = await Promise.all([
      this.getPluginPageCount(),
      this.getAssistantPageCount(),
      this.getModelPageCount(),
    ]);

    // Generate paginated sitemap links
    const paginatedSitemaps = [
      ...Array.from({ length: pluginPages }, (_, i) =>
        this._generateSitemapLink(
          getCanonicalUrl(SITEMAP_BASE_URL, isDev ? `plugins-${i + 1}` : `plugins-${i + 1}.xml`),
        ),
      ),
      ...Array.from({ length: assistantPages }, (_, i) =>
        this._generateSitemapLink(
          getCanonicalUrl(
            SITEMAP_BASE_URL,
            isDev ? `assistants-${i + 1}` : `assistants-${i + 1}.xml`,
          ),
        ),
      ),
      ...Array.from({ length: modelPages }, (_, i) =>
        this._generateSitemapLink(
          getCanonicalUrl(SITEMAP_BASE_URL, isDev ? `models-${i + 1}` : `models-${i + 1}.xml`),
        ),
      ),
    ];

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...staticSitemaps,
      ...paginatedSitemaps,
      '</sitemapindex>',
    ].join('\n');
  }

  async getAssistants(page?: number): Promise<MetadataRoute.Sitemap> {
    const list = await this.discoverService.getAssistantIdentifiers();

    if (page !== undefined) {
      const startIndex = (page - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;
      const pageAssistants = list.slice(startIndex, endIndex);

      const sitmap = pageAssistants
        .filter((item) => item.identifier) // Filter out items with empty identifiers
        .map((item) =>
          this._genSitemap(urlJoin('/community/agent', item.identifier), {
            lastModified: item?.lastModified || LAST_MODIFIED,
          }),
        );
      return flatten(sitmap);
    }

    // If page number is not specified, return all (backward compatibility)
    const sitmap = list
      .filter((item) => item.identifier) // Filter out items with empty identifiers
      .map((item) =>
        this._genSitemap(urlJoin('/community/agent', item.identifier), {
          lastModified: item?.lastModified || LAST_MODIFIED,
        }),
      );
    return flatten(sitmap);
  }

  async getPlugins(page?: number): Promise<MetadataRoute.Sitemap> {
    const list = await this.discoverService.getPluginIdentifiers();

    if (page !== undefined) {
      const startIndex = (page - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;
      const pagePlugins = list.slice(startIndex, endIndex);

      const sitmap = pagePlugins
        .filter((item) => item.identifier) // Filter out items with empty identifiers
        .map((item) =>
          this._genSitemap(urlJoin('/community/plugin', item.identifier), {
            lastModified: item?.lastModified || LAST_MODIFIED,
          }),
        );
      return flatten(sitmap);
    }

    // If page number is not specified, return all (backward compatibility)
    const sitmap = list
      .filter((item) => item.identifier) // Filter out items with empty identifiers
      .map((item) =>
        this._genSitemap(urlJoin('/community/plugin', item.identifier), {
          lastModified: item?.lastModified || LAST_MODIFIED,
        }),
      );
    return flatten(sitmap);
  }

  async getModels(page?: number): Promise<MetadataRoute.Sitemap> {
    const list = await this.discoverService.getModelIdentifiers();

    if (page !== undefined) {
      const startIndex = (page - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;
      const pageModels = list.slice(startIndex, endIndex);

      const sitmap = pageModels
        .filter((item) => item.identifier) // Filter out items with empty identifiers
        .map((item) =>
          this._genSitemap(urlJoin('/community/model', item.identifier), {
            lastModified: item?.lastModified || LAST_MODIFIED,
          }),
        );
      return flatten(sitmap);
    }

    // If page number is not specified, return all (backward compatibility)
    const sitmap = list
      .filter((item) => item.identifier) // Filter out items with empty identifiers
      .map((item) =>
        this._genSitemap(urlJoin('/community/model', item.identifier), {
          lastModified: item?.lastModified || LAST_MODIFIED,
        }),
      );
    return flatten(sitmap);
  }

  async getProviders(): Promise<MetadataRoute.Sitemap> {
    const list = await this.discoverService.getProviderIdentifiers();
    const sitmap = list
      .filter((item) => item.identifier) // Filter out items with empty identifiers
      .map((item) =>
        this._genSitemap(urlJoin('/community/provider', item.identifier), {
          lastModified: item?.lastModified || LAST_MODIFIED,
        }),
      );
    return flatten(sitmap);
  }

  async getPage(): Promise<MetadataRoute.Sitemap> {
    const hideDocs = serverFeatureFlags().hideDocs;
    return [
      ...this._genSitemap('/', { noLocales: true }),
      ...this._genSitemap('/agent', { noLocales: true }),
      ...(!hideDocs ? this._genSitemap('/changelog', { noLocales: true }) : []),
      /* ↓ cloud slot ↓ */

      /* ↑ cloud slot ↑ */
      ...this._genSitemap('/community', { changeFrequency: 'daily', priority: 0.7 }),
      ...this._genSitemap('/community/agent', { changeFrequency: 'daily', priority: 0.7 }),
      ...this._genSitemap('/community/mcp', { changeFrequency: 'daily', priority: 0.7 }),
      ...this._genSitemap('/community/plugin', { changeFrequency: 'daily', priority: 0.7 }),
      ...this._genSitemap('/community/model', { changeFrequency: 'daily', priority: 0.7 }),
      ...this._genSitemap('/community/provider', { changeFrequency: 'daily', priority: 0.7 }),
    ].filter(Boolean);
  }
  getRobots() {
    return [
      getCanonicalUrl('/sitemap-index.xml'),
      ...this.sitemapIndexs.map((index) =>
        getCanonicalUrl(SITEMAP_BASE_URL, isDev ? index.id : `${index.id}.xml`),
      ),
    ];
  }
}
