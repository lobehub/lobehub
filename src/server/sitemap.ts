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
export const SITEMAP_REVALIDATE_SECONDS = 86_400;

// Number of items per page
const ITEMS_PER_PAGE = 100;
const DEFAULT_MODEL_PAGE_COUNT_TIMEOUT_MS = 15 * 60 * 1000;
const SITEMAP_IDENTIFIER_CACHE_TTL_MS = SITEMAP_REVALIDATE_SECONDS * 1000;

interface SitemapOptions {
  modelPageCountTimeoutMs?: number;
}

type SitemapIdentifiersKey = 'assistant' | 'model' | 'plugin' | 'provider';
interface SitemapIdentifiersCacheEntry {
  expiresAt: number;
  promise: Promise<IdentifiersResponse>;
}

const discoverService = new DiscoverService();
const sitemapIdentifiersCache: Partial<
  Record<SitemapIdentifiersKey, SitemapIdentifiersCacheEntry>
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
  cacheTtlMs = SITEMAP_IDENTIFIER_CACHE_TTL_MS,
) {
  const cached = sitemapIdentifiersCache[key];
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = withSitemapIdentifierTimeout(key, loader(), timeoutMs).catch((error) => {
    delete sitemapIdentifiersCache[key];
    console.error(`[SitemapIdentifierFetchError] failed to fetch ${key} sitemap identifiers`);
    console.error(error);
    return [];
  });

  sitemapIdentifiersCache[key] = {
    expiresAt: Date.now() + cacheTtlMs,
    promise,
  };

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
      reject(
        new Error(
          `Timed out fetching ${key} sitemap identifiers after ${timeoutMs}ms`,
        ),
      );
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

  private _appendLocalizedItems(
    target: MetadataRoute.Sitemap,
    list: IdentifiersResponse,
    routePrefix: string,
    page?: number,
  ) {
    const startIndex = page !== undefined ? (page - 1) * ITEMS_PER_PAGE : 0;
    const endIndex = page !== undefined ? Math.min(startIndex + ITEMS_PER_PAGE, list.length) : list.length;

    for (let index = startIndex; index < endIndex; index += 1) {
      const item = list[index];
      if (!item?.identifier) continue;

      const lastModified = item.lastModified || LAST_MODIFIED;

      for (const locale of allLocales) {
        target.push(
          this._genSitemapItem(locale, urlJoin(routePrefix, item.identifier), {
            lastModified,
          }),
        );
      }
    }

    return target;
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
    const list = await getCachedIdentifiers('assistant', () =>
      this.discoverService.getAssistantIdentifiers(),
    );
    return this._appendLocalizedItems([], list, '/community/agent', page);
  }

  async getPlugins(page?: number): Promise<MetadataRoute.Sitemap> {
    const list = await getCachedIdentifiers('plugin', () =>
      this.discoverService.getPluginIdentifiers(),
    );
    return this._appendLocalizedItems([], list, '/community/plugin', page);
  }

  async getModels(page?: number): Promise<MetadataRoute.Sitemap> {
    const list = await getCachedIdentifiers(
      'model',
      () => this.discoverService.getModelIdentifiers(),
      this.modelPageCountTimeoutMs,
    );
    return this._appendLocalizedItems([], list, '/community/model', page);
  }

  async getProviders(): Promise<MetadataRoute.Sitemap> {
    const list = await getCachedIdentifiers('provider', () =>
      this.discoverService.getProviderIdentifiers(),
    );
    return this._appendLocalizedItems([], list, '/community/provider');
  }

  async getPage(): Promise<MetadataRoute.Sitemap> {
    const hideDocs = serverFeatureFlags().hideDocs;
    return [
      ...this._genSitemap('/', { noLocales: true }),
      ...this._genSitemap('/agent', { noLocales: true }),
      ...(!hideDocs ? this._genSitemap('/changelog', { noLocales: true }) : []),
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

export function clearSitemapCaches() {
  clearCachedIdentifiers();
}
