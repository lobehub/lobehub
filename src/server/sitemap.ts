import { type IdentifiersResponse } from '@lobechat/types';
import { type MetadataRoute } from 'next';
import qs from 'query-string';
import urlJoin from 'url-join';

import { serverFeatureFlags } from '@/config/featureFlags';
import { DEFAULT_LANG } from '@/const/locale';
import { SITEMAP_BASE_URL } from '@/const/url';
import { type Locales } from '@/locales/resources';
import { locales as allLocales } from '@/locales/resources';
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
const DEFAULT_MODEL_PAGE_COUNT_TIMEOUT_MS = 15 * 60 * 1000;

interface SitemapOptions {
  modelPageCountTimeoutMs?: number;
}

type SitemapIdentifiersKey = 'assistant' | 'model' | 'plugin' | 'provider';

const discoverService = new DiscoverService();
const sitemapIdentifiersCache: Partial<
  Record<SitemapIdentifiersKey, Promise<IdentifiersResponse>>
> = {};
const SITEMAP_IDENTIFIER_TIMEOUT_MS = 15_000;

function clearCachedIdentifiers() {
  delete sitemapIdentifiersCache.assistant;
  delete sitemapIdentifiersCache.model;
  delete sitemapIdentifiersCache.plugin;
  delete sitemapIdentifiersCache.provider;
}

function getCachedIdentifiers(
  key: SitemapIdentifiersKey,
  loader: () => Promise<IdentifiersResponse>,
  timeoutMs = SITEMAP_IDENTIFIER_TIMEOUT_MS,
) {
  const cached = sitemapIdentifiersCache[key];
  if (cached) return cached;

  const promise = withSitemapIdentifierTimeout(key, loader(), timeoutMs).catch((error) => {
    delete sitemapIdentifiersCache[key];
    console.error(`[SitemapIdentifierFetchError] failed to fetch ${key} sitemap identifiers`);
    console.error(error);
    return [];
  });

  sitemapIdentifiersCache[key] = promise;
  return promise;
}

async function withSitemapIdentifierTimeout(
  key: SitemapIdentifiersKey,
  promise: Promise<IdentifiersResponse>,
  timeoutMs: number,
): Promise<IdentifiersResponse> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out fetching ${key} sitemap identifiers after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class Sitemap {
  private modelPageCountTimeoutMs: number;

  sitemapIndexs = [{ id: SitemapType.Pages }, { id: SitemapType.Providers }];

  private discoverService = discoverService;

  constructor(options: SitemapOptions = {}) {
    this.modelPageCountTimeoutMs =
      options.modelPageCountTimeoutMs ?? DEFAULT_MODEL_PAGE_COUNT_TIMEOUT_MS;
  }

  // Get total number of plugin pages
  async getPluginPageCount(): Promise<number> {
    const list = await getCachedIdentifiers('plugin', () =>
      this.discoverService.getPluginIdentifiers(),
    );
    return Math.ceil(list.length / ITEMS_PER_PAGE);
  }

  // Get total number of assistant pages
  async getAssistantPageCount(): Promise<number> {
    const list = await getCachedIdentifiers('assistant', () =>
      this.discoverService.getAssistantIdentifiers(),
    );
    return Math.ceil(list.length / ITEMS_PER_PAGE);
  }

  // Get total number of model pages
  async getModelPageCount(): Promise<number> {
    const list = await getCachedIdentifiers(
      'model',
      () => this.discoverService.getModelIdentifiers(),
      this.modelPageCountTimeoutMs,
    );
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

  private _appendSitemapEntries(
    target: MetadataRoute.Sitemap,
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
    if (noLocales) {
      target.push(
        this._genSitemapItem(DEFAULT_LANG, url, {
          changeFrequency,
          lastModified,
          locales,
          noLocales,
          priority,
        }),
      );
      return;
    }

    for (const lang of locales) {
      target.push(
        this._genSitemapItem(lang, url, {
          changeFrequency,
          lastModified,
          locales,
          noLocales,
          priority,
        }),
      );
    }
  }

  async getIndex(): Promise<string> {
    const [pluginPages, assistantPages, modelPages] = await Promise.all([
      this.getPluginPageCount(),
      this.getAssistantPageCount(),
      this.getModelPageCount(),
    ]);

    const links = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ];

    for (const item of this.sitemapIndexs) {
      links.push(
        this._generateSitemapLink(
          getCanonicalUrl(SITEMAP_BASE_URL, isDev ? item.id : `${item.id}.xml`),
        ),
      );
    }

    for (let i = 0; i < pluginPages; i += 1) {
      links.push(
        this._generateSitemapLink(
          getCanonicalUrl(SITEMAP_BASE_URL, isDev ? `plugins-${i + 1}` : `plugins-${i + 1}.xml`),
        ),
      );
    }

    for (let i = 0; i < assistantPages; i += 1) {
      links.push(
        this._generateSitemapLink(
          getCanonicalUrl(
            SITEMAP_BASE_URL,
            isDev ? `assistants-${i + 1}` : `assistants-${i + 1}.xml`,
          ),
        ),
      );
    }

    for (let i = 0; i < modelPages; i += 1) {
      links.push(
        this._generateSitemapLink(
          getCanonicalUrl(SITEMAP_BASE_URL, isDev ? `models-${i + 1}` : `models-${i + 1}.xml`),
        ),
      );
    }

    links.push('</sitemapindex>');
    return links.join('\n');
  }

  async getAssistants(page?: number): Promise<MetadataRoute.Sitemap> {
    const list = await getCachedIdentifiers('assistant', () =>
      this.discoverService.getAssistantIdentifiers(),
    );
    const sitemap: MetadataRoute.Sitemap = [];

    if (page !== undefined) {
      const startIndex = (page - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;
      const pageAssistants = list.slice(startIndex, endIndex);

      for (const item of pageAssistants) {
        if (!item.identifier) continue;
        this._appendSitemapEntries(sitemap, urlJoin('/community/agent', item.identifier), {
          lastModified: item?.lastModified || LAST_MODIFIED,
        });
      }
      return sitemap;
    }

    // If page number is not specified, return all (backward compatibility)
    for (const item of list) {
      if (!item.identifier) continue;
      this._appendSitemapEntries(sitemap, urlJoin('/community/agent', item.identifier), {
        lastModified: item?.lastModified || LAST_MODIFIED,
      });
    }
    return sitemap;
  }

  async getPlugins(page?: number): Promise<MetadataRoute.Sitemap> {
    const list = await getCachedIdentifiers('plugin', () =>
      this.discoverService.getPluginIdentifiers(),
    );
    const sitemap: MetadataRoute.Sitemap = [];

    if (page !== undefined) {
      const startIndex = (page - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;
      const pagePlugins = list.slice(startIndex, endIndex);

      for (const item of pagePlugins) {
        if (!item.identifier) continue;
        this._appendSitemapEntries(sitemap, urlJoin('/community/plugin', item.identifier), {
          lastModified: item?.lastModified || LAST_MODIFIED,
        });
      }
      return sitemap;
    }

    // If page number is not specified, return all (backward compatibility)
    for (const item of list) {
      if (!item.identifier) continue;
      this._appendSitemapEntries(sitemap, urlJoin('/community/plugin', item.identifier), {
        lastModified: item?.lastModified || LAST_MODIFIED,
      });
    }
    return sitemap;
  }

  async getModels(page?: number): Promise<MetadataRoute.Sitemap> {
    const list = await getCachedIdentifiers('model', () =>
      this.discoverService.getModelIdentifiers(),
    );
    const sitemap: MetadataRoute.Sitemap = [];

    if (page !== undefined) {
      const startIndex = (page - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;
      const pageModels = list.slice(startIndex, endIndex);

      for (const item of pageModels) {
        if (!item.identifier) continue;
        this._appendSitemapEntries(sitemap, urlJoin('/community/model', item.identifier), {
          lastModified: item?.lastModified || LAST_MODIFIED,
        });
      }
      return sitemap;
    }

    // If page number is not specified, return all (backward compatibility)
    for (const item of list) {
      if (!item.identifier) continue;
      this._appendSitemapEntries(sitemap, urlJoin('/community/model', item.identifier), {
        lastModified: item?.lastModified || LAST_MODIFIED,
      });
    }
    return sitemap;
  }

  async getProviders(): Promise<MetadataRoute.Sitemap> {
    const list = await getCachedIdentifiers('provider', () =>
      this.discoverService.getProviderIdentifiers(),
    );
    const sitemap: MetadataRoute.Sitemap = [];
    for (const item of list) {
      if (!item.identifier) continue;
      this._appendSitemapEntries(sitemap, urlJoin('/community/provider', item.identifier), {
        lastModified: item?.lastModified || LAST_MODIFIED,
      });
    }
    return sitemap;
  }

  async getPage(): Promise<MetadataRoute.Sitemap> {
    const hideDocs = serverFeatureFlags().hideDocs;
    const sitemap: MetadataRoute.Sitemap = [];
    this._appendSitemapEntries(sitemap, '/', { noLocales: true });
    this._appendSitemapEntries(sitemap, '/agent', { noLocales: true });
    if (!hideDocs) {
      this._appendSitemapEntries(sitemap, '/changelog', { noLocales: true });
    }
    this._appendSitemapEntries(sitemap, '/community', { changeFrequency: 'daily', priority: 0.7 });
    this._appendSitemapEntries(sitemap, '/community/agent', {
      changeFrequency: 'daily',
      priority: 0.7,
    });
    this._appendSitemapEntries(sitemap, '/community/mcp', {
      changeFrequency: 'daily',
      priority: 0.7,
    });
    this._appendSitemapEntries(sitemap, '/community/plugin', {
      changeFrequency: 'daily',
      priority: 0.7,
    });
    this._appendSitemapEntries(sitemap, '/community/model', {
      changeFrequency: 'daily',
      priority: 0.7,
    });
    this._appendSitemapEntries(sitemap, '/community/provider', {
      changeFrequency: 'daily',
      priority: 0.7,
    });
    return sitemap;
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

export function clearSitemapCaches() {
  clearCachedIdentifiers();
}
