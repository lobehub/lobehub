import { builtinTools } from '@lobechat/builtin-tools';
import { COMPOSIO_APP_TYPES, DEFAULT_DISCOVER_PLUGIN_ITEM, OFFICIAL_SITE } from '@lobechat/const';
import {
  type DiscoverPluginDetail,
  type DiscoverPluginItem,
  type IdentifiersResponse,
  type PluginListResponse,
  type PluginQueryParams,
} from '@lobechat/types';
import { PluginSorts } from '@lobechat/types';
import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import dayjs from 'dayjs';
import { cloneDeep, countBy, isString, merge } from 'es-toolkit/compat';

import { normalizeLocale } from '@/locales/resources';

import type { DiscoverService } from './index';
import { isMarketNotFound, log } from './utils';

// ============================== Plugin Market ==============================

export const listPluginItems = async (
  service: DiscoverService,
  locale?: string,
): Promise<DiscoverPluginItem[]> => {
  log('_getPluginList: locale=%s', locale);
  const normalizedLocale = normalizeLocale(locale);
  const list = await service.pluginStore.getPluginList(normalizedLocale);
  if (!list || !Array.isArray(list)) {
    log('_getPluginList: no valid list found, returning empty array');
    return [];
  }
  const result = list.map(({ meta, ...item }) => ({ ...item, ...meta }));
  log('_getPluginList: returning %d items', result.length);
  return result;
};

export const getLegacyPluginList = async (
  service: DiscoverService,
  { locale }: { locale?: string } = {},
): Promise<any> => {
  log('getLegacyPluginList: locale=%s', locale);
  const normalizedLocale = normalizeLocale(locale);
  const result = await service.pluginStore.getPluginList(normalizedLocale);
  log('getLegacyPluginList: returning plugin list');
  return result;
};

export const getPluginCategories = async (
  service: DiscoverService,
  params: CategoryListQuery = {},
): Promise<CategoryItem[]> => {
  log('getPluginCategories: params=%O', params);
  const { q, locale } = params;
  let list = await listPluginItems(service, locale);
  if (q) {
    const originalCount = list.length;
    list = list.filter((item) => {
      return [item.author, item.title, item.description, item?.tags]
        .flat()
        .filter(Boolean)
        .join(',')
        .toLowerCase()
        .includes(decodeURIComponent(q).toLowerCase());
    });
    log(
      'getPluginCategories: filtered by query "%s", %d -> %d items',
      q,
      originalCount,
      list.length,
    );
  }
  const categoryCounts = countBy(list, (item) => item.category);
  const result = Object.entries(categoryCounts)
    .filter(([category]) => Boolean(category)) // Filter out empty values
    .map(([category, count]) => ({
      category,
      count,
    }));
  log('getPluginCategories: returning %d categories', result.length);
  return result;
};

export const getPluginDetail = async (
  service: DiscoverService,
  params: {
    identifier: string;
    locale?: string;
    withManifest?: boolean;
  },
): Promise<DiscoverPluginDetail | undefined> => {
  log('getPluginDetail: params=%O', params);
  const { locale, identifier, withManifest } = params;

  // Step 1: Try to find in legacy plugin list
  const all = await listPluginItems(service, locale);
  const raw = all.find((item) => item.identifier === identifier);
  if (raw) {
    log('getPluginDetail: found plugin in legacy list for identifier=%s', identifier);
    const mergedRaw = merge(cloneDeep(DEFAULT_DISCOVER_PLUGIN_ITEM), raw);
    const list = await service.getPluginList({
      category: mergedRaw.category,
      locale,
      page: 1,
      pageSize: 7,
    });

    const plugin: DiscoverPluginDetail = {
      ...mergedRaw,
      related: list.items.filter((item) => item.identifier !== mergedRaw.identifier).slice(0, 6),
      source: 'legacy',
    };

    if (!withManifest || !plugin?.manifest || !isString(plugin?.manifest)) {
      log('getPluginDetail: returning legacy plugin without manifest processing');
      return plugin;
    }

    return plugin;
  }

  // Step 2: Try to find in Market MCP plugins
  log(
    'getPluginDetail: plugin not found in legacy store for identifier=%s, trying MCP plugin',
    identifier,
  );
  try {
    const mcpDetail = await service.getMcpDetail({ identifier, locale });
    const convertedMcp: Partial<DiscoverPluginDetail> = {
      author:
        typeof (mcpDetail as any).author === 'object'
          ? (mcpDetail as any).author?.name || ''
          : (mcpDetail as any).author || '',
      avatar: (mcpDetail as any).icon || (mcpDetail as any).avatar || '',
      category: (mcpDetail as any).category as any,
      createdAt: (mcpDetail as any).createdAt || '',
      description: mcpDetail.description || '',
      homepage: mcpDetail.homepage || '',
      identifier: mcpDetail.identifier,
      manifest: undefined,
      related: mcpDetail.related.map((item) => ({
        author:
          typeof (item as any).author === 'object'
            ? (item as any).author?.name || ''
            : (item as any).author || '',
        avatar: (item as any).icon || (item as any).avatar || '',
        category: (item as any).category as any,
        createdAt: (item as any).createdAt || '',
        description: (item as any).description || '',
        homepage: (item as any).homepage || '',
        identifier: item.identifier,
        manifest: undefined,
        schemaVersion: 1,
        tags: (item as any).tags || [],
        title: (item as any).name || item.identifier,
      })) as unknown as DiscoverPluginItem[],
      schemaVersion: 1,
      source: 'market',
      tags: (mcpDetail as any).tags || [],
      title: (mcpDetail as any).name || mcpDetail.identifier,
    };
    const plugin = merge(cloneDeep(DEFAULT_DISCOVER_PLUGIN_ITEM), convertedMcp);
    log('getPluginDetail: returning converted MCP plugin');
    return plugin as DiscoverPluginDetail;
  } catch (error) {
    if (!isMarketNotFound(error)) throw error;
    log(
      'getPluginDetail: MCP plugin not found for identifier=%s, trying builtin tools',
      identifier,
    );
  }

  // Step 3: Try to find in builtin tools
  const builtinTool = builtinTools.find((tool) => tool.identifier === identifier);
  if (builtinTool) {
    log('getPluginDetail: found builtin tool for identifier=%s', identifier);
    const plugin: DiscoverPluginDetail = {
      author: 'LobeHub',
      avatar: builtinTool.manifest.meta.avatar || '',
      category: undefined,
      createdAt: '',
      description: builtinTool.manifest.meta.description || '',
      homepage: OFFICIAL_SITE,
      identifier: builtinTool.identifier,
      manifest: undefined,
      related: [],
      schemaVersion: 1,
      source: 'builtin',
      tags: builtinTool.manifest.meta.tags || [],
      title: builtinTool.manifest.meta.title,
    };
    log('getPluginDetail: returning builtin tool plugin');
    return plugin;
  }

  // Step 4: Try to find in Composio server types (builtin tools that require env config)
  const composioTool = COMPOSIO_APP_TYPES.find((tool) => tool.identifier === identifier);
  if (composioTool) {
    log('getPluginDetail: found Composio tool for identifier=%s', identifier);

    // Avatar is empty here because frontend will render Composio icons using ComposioIcon component
    // which handles both string URLs and React component icons
    const plugin: DiscoverPluginDetail = {
      author: 'Composio',
      avatar: typeof composioTool.icon === 'string' ? composioTool.icon : '',
      category: undefined,
      createdAt: '',
      description: `LobeHub Mcp Server: ${composioTool.label}`,
      homepage: 'https://composio.dev',
      identifier: composioTool.identifier,
      manifest: undefined,
      related: [],
      schemaVersion: 1,
      source: 'builtin',
      tags: ['composio', 'mcp'],
      title: composioTool.label,
    };
    log('getPluginDetail: returning Composio tool plugin');
    return plugin;
  }

  log('getPluginDetail: plugin not found anywhere for identifier=%s', identifier);
  return;
};

export const getPluginIdentifiers = async (
  service: DiscoverService,
): Promise<IdentifiersResponse> => {
  log('getPluginIdentifiers: fetching identifiers');
  const list = await listPluginItems(service);
  const result = list.map((item) => {
    return {
      identifier: item.identifier,
      lastModified: item.createdAt,
    };
  });
  log('getPluginIdentifiers: returning %d identifiers', result.length);
  return result;
};

export const getPluginList = async (
  service: DiscoverService,
  params: PluginQueryParams = {},
): Promise<PluginListResponse> => {
  log('getPluginList: params=%O', params);
  const {
    locale,
    category,
    order = 'desc',
    page = 1,
    pageSize = 20,
    q,
    sort = PluginSorts.CreatedAt,
  } = params;

  let list = await listPluginItems(service, locale);
  const originalCount = list.length;

  if (category) {
    list = list.filter((item) => item.category === category);
    log(
      'getPluginList: filtered by category "%s", %d -> %d items',
      category,
      originalCount,
      list.length,
    );
  }

  if (q) {
    const beforeFilter = list.length;
    list = list.filter((item) => {
      return [item.author, item.title, item.description, item?.tags]
        .flat()
        .filter(Boolean)
        .join(',')
        .toLowerCase()
        .includes(decodeURIComponent(q).toLowerCase());
    });
    log('getPluginList: filtered by query "%s", %d -> %d items', q, beforeFilter, list.length);
  }

  if (sort) {
    log('getPluginList: sorting by %s %s', sort, order);
    switch (sort) {
      case PluginSorts.CreatedAt: {
        list = list.sort((a, b) => {
          if (order === 'asc') {
            return dayjs(a.createdAt).unix() - dayjs(b.createdAt).unix();
          } else {
            return dayjs(b.createdAt).unix() - dayjs(a.createdAt).unix();
          }
        });
        break;
      }
      case PluginSorts.Identifier: {
        list = list.sort((a, b) => {
          if (order === 'desc') {
            return a.identifier.localeCompare(b.identifier);
          } else {
            return b.identifier.localeCompare(a.identifier);
          }
        });
        break;
      }
      case PluginSorts.Title: {
        list = list.sort((a, b) => {
          if (order === 'desc') {
            return a.title.localeCompare(b.title);
          } else {
            return b.title.localeCompare(a.title);
          }
        });
        break;
      }
    }
  }

  const result = {
    currentPage: page,
    items: list.slice((page - 1) * pageSize, page * pageSize),
    pageSize,
    totalCount: list.length,
    totalPages: Math.ceil(list.length / pageSize),
  };
  log(
    'getPluginList: returning page %d/%d with %d items',
    page,
    result.totalPages,
    result.items.length,
  );
  return result;
};
