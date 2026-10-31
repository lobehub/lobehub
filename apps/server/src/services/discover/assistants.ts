import { discoverUrl } from '@lobechat/const';
import {
  type AgentStatus,
  type AssistantListResponse,
  type AssistantMarketSource,
  type AssistantQueryParams,
  type DiscoverAssistantDetail,
  type DiscoverAssistantItem,
  type IdentifiersResponse,
} from '@lobechat/types';
import { AssistantCategory, AssistantSorts } from '@lobechat/types';
import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';

import { normalizeLocale } from '@/locales/resources';

import {
  isLegacySource,
  legacyGetAssistantCategories,
  legacyGetAssistantDetail,
  legacyGetAssistantIdentifiers,
  legacyGetAssistantList,
} from './assistantsLegacy';
import type { DiscoverService } from './index';
import { isMarketNotFound, log, normalizeAuthorField } from './utils';

// ============================== Assistant Market ==============================

export const getAssistantCategories = async (
  service: DiscoverService,
  params: CategoryListQuery & { source?: AssistantMarketSource } = {},
): Promise<CategoryItem[]> => {
  log('getAssistantCategories: params=%O', params);
  const { source, ...rest } = params;
  if (isLegacySource(source)) {
    return legacyGetAssistantCategories(service, rest);
  }

  const { q, locale } = rest;
  const normalizedLocale = normalizeLocale(locale);

  try {
    // @ts-ignore
    const categories = await service.market.agents.getCategories({
      locale: normalizedLocale,
      q,
    });
    log('getAssistantCategories: returning %d categories from market SDK', categories.length);
    return categories;
  } catch (error) {
    log('getAssistantCategories: error fetching from market SDK: %O', error);
    return [];
  }
};

export const getAssistantDetail = async (
  service: DiscoverService,
  params: {
    identifier: string;
    locale?: string;
    source?: AssistantMarketSource;
    version?: string;
  },
): Promise<DiscoverAssistantDetail | undefined> => {
  log('getAssistantDetail: params=%O', params);
  const { source, ...rest } = params;
  if (isLegacySource(source)) {
    return legacyGetAssistantDetail(service, rest);
  }

  const { locale, identifier, version } = rest;
  const normalizedLocale = normalizeLocale(locale);

  try {
    const data = await service.market.agents.getAgentDetail(identifier, {
      locale: normalizedLocale,
      version,
    });
    if (!data) {
      log('getAssistantDetail: assistant not found for identifier=%s', identifier);
      return;
    }
    const normalizedAuthor = normalizeAuthorField(data.author);
    const assistant = {
      author: normalizedAuthor.name || (data.ownerId !== null ? `User${data.ownerId}` : 'Unknown'),
      avatar: data.avatar || normalizedAuthor.name || '',
      category: (data as any).category || 'general',
      // The market SDK types this as a bare record; the detail shape this
      // builds declares the agent config it actually carries.
      config: (data.config || {}) as unknown as DiscoverAssistantDetail['config'],
      createdAt: (data as any).createdAt,
      currentVersion: data.version,
      description: (data as any).description || data.summary,
      // @ts-ignore
      editorData: data.editorData || {},

      examples: Array.isArray((data as any).examples)
        ? (data as any).examples.map((example: any) => ({
            content: typeof example === 'string' ? example : example.content || '',
            role: example.role || 'user',
          }))
        : [],
      forkCount: (data as any).forkCount,
      forkedFromAgentId: (data as any).forkedFromAgentId,
      homepage: (data as any).homepage || discoverUrl('assistant', (data as any).identifier),
      identifier: (data as any).identifier,
      isValidated: (data as any).isValidated,
      knowledgeCount:
        (data.config as any)?.knowledgeBases?.length || (data as any).knowledgeCount || 0,
      pluginCount: (data.config as any)?.plugins?.length || (data as any).pluginCount || 0,
      readme: data.documentationUrl || '',
      schemaVersion: 1,
      ownerType: normalizedAuthor.ownerType,
      status: (data.status as AgentStatus) || undefined,
      summary: data.summary || '',
      systemRole: (data.config as any)?.systemRole || '',
      tags: data.tags || [],
      title: (data as any).name || (data as any).identifier,
      tokenUsage: data.tokenUsage || 0,
      userName: normalizedAuthor.userName,
      versions:
        // @ts-ignore
        data.versions?.map((item) => ({
          createdAt: (item as any).createdAt || item.updatedAt,
          isLatest: item.isLatest,
          isValidated: item.isValidated,
          status: item.status as any,
          version: item.version,
        })) || [],
    };
    // Get related assistants
    const list = await service.getAssistantList({
      category: assistant.category,
      includeAgentGroup: true,
      locale,
      page: 1,
      pageSize: 7,
      source,
    });
    const result = {
      ...assistant,
      related: list.items.filter((item) => item.identifier !== assistant.identifier).slice(0, 6),
    };
    log('getAssistantDetail: returning assistant with %d related items', result.related.length);
    return result;
  } catch (error) {
    log('getAssistantDetail: error fetching from market SDK: %O', error);
    if (!isMarketNotFound(error)) throw error;
  }
};

export const getAssistantIdentifiers = async (
  service: DiscoverService,
  params: { source?: AssistantMarketSource } = {},
): Promise<IdentifiersResponse> => {
  log('getAssistantIdentifiers: fetching identifiers with params=%O', params);
  if (isLegacySource(params.source)) {
    return legacyGetAssistantIdentifiers(service);
  }

  try {
    // @ts-ignore
    const identifiers = await service.market.agents.getPublishedIdentifiers();
    // @ts-ignore
    const result = identifiers.map((item) => ({
      identifier: item.id,
      lastModified: item.lastModified,
    }));
    log('getAssistantIdentifiers: returning %d identifiers from market SDK', result.length);
    return result;
  } catch (error) {
    log('getAssistantIdentifiers: error fetching from market SDK: %O', error);
    return [];
  }
};

export const getAssistantList = async (
  service: DiscoverService,
  params: AssistantQueryParams = {},
  options: { throwOnError?: boolean } = {},
): Promise<AssistantListResponse> => {
  log('getAssistantList: params=%O', params);
  const { source, ...rest } = params;
  if (isLegacySource(source)) {
    return legacyGetAssistantList(service, rest);
  }

  const {
    locale,
    category,
    order = 'desc',
    page = 1,
    pageSize = 20,
    q,
    sort = AssistantSorts.Recommended,
    ownerId,
    includeAgentGroup,
    includeCategoryCounts,
  } = rest;
  const shouldOmitCategory = [AssistantCategory.All, AssistantCategory.Discover].includes(
    category as AssistantCategory,
  );

  try {
    const normalizedLocale = normalizeLocale(locale);

    let apiSort: 'createdAt' | 'updatedAt' | 'name' | 'mostUsage' | 'recommended' = 'recommended';
    let haveSkills: boolean | undefined = rest.haveSkills;

    switch (sort) {
      case AssistantSorts.UpdatedAt: {
        apiSort = 'updatedAt';
        break;
      }
      case AssistantSorts.MostUsage: {
        apiSort = 'mostUsage';
        break;
      }
      case AssistantSorts.HaveSkills: {
        // When user selects "Skilled", set haveSkills=true and use recommended sort
        haveSkills = true;
        apiSort = 'updatedAt';
        break;
      }
      case AssistantSorts.Recommended: {
        apiSort = 'recommended';
        break;
      }
      default: {
        apiSort = 'recommended';
      }
    }

    const data = await service.market.agents.getAgentList({
      category: shouldOmitCategory ? undefined : category,
      haveSkills,
      // includeAgentGroup may not be in SDK type definition yet, using 'as any'
      includeAgentGroup,
      includeCategoryCounts,
      locale: normalizedLocale,
      order,
      ownerId,
      page,
      pageSize,
      q,
      sort: apiSort,
      status: 'published',
      visibility: 'public',
    } as any);

    const transformedItems: DiscoverAssistantItem[] = (data.items || []).map((item: any) => {
      const normalizedAuthor = normalizeAuthorField(item.author);
      return {
        author:
          normalizedAuthor.name || (item.ownerId !== null ? `User${item.ownerId}` : 'Unknown'),
        avatar: item.avatar || normalizedAuthor.name || '',
        category: item.category || 'general',
        config: item.config || {},
        createdAt: item.createdAt || item.updatedAt || new Date().toISOString(),
        description: item.description || item.summary || '',
        forkCount: item.forkCount,
        homepage: item.homepage || discoverUrl('assistant', item.identifier),
        identifier: item.identifier,
        installCount: item.installCount,
        knowledgeCount: item.knowledgeCount ?? item.config?.knowledgeBases?.length ?? 0,
        pluginCount: item.pluginCount ?? item.config?.plugins?.length ?? 0,
        schemaVersion: item.schemaVersion ?? 1,
        tags: item.tags || [],
        title: item.name || item.identifier,
        tokenUsage: item.tokenUsage || 0,
        type: item.type,
        updatedAt: item.updatedAt,
        userName: normalizedAuthor.userName,
      };
    });

    const result: AssistantListResponse = {
      ...((data as any).categoryCounts ? { categoryCounts: (data as any).categoryCounts } : {}),
      currentPage: data.currentPage || page,
      items: transformedItems,
      pageSize: data.pageSize || pageSize,
      totalCount: data.totalCount || 0,
      totalPages: data.totalPages || 0,
    };

    log(
      'getAssistantList: returning page %d/%d with %d items from market SDK',
      result.currentPage,
      result.totalPages,
      result.items.length,
    );
    return result;
  } catch (error) {
    log('getAssistantList: error fetching from market SDK: %O', error);
    if (options.throwOnError) throw error;

    return {
      currentPage: page,
      items: [],
      pageSize,
      totalCount: 0,
      totalPages: 0,
    };
  }
};

/**
 * Get agents that use a specific plugin
 */
export const getAgentsByPlugin = async (
  service: DiscoverService,
  params: {
    locale?: string;
    page?: number;
    pageSize?: number;
    pluginId: string;
  },
): Promise<AssistantListResponse> => {
  log('getAgentsByPlugin: params=%O', params);
  const { locale, pluginId, page = 1, pageSize = 20 } = params;
  const normalizedLocale = normalizeLocale(locale);

  try {
    const data = await service.market.agents.getAgentsByPlugin({
      locale: normalizedLocale,
      page,
      pageSize,
      pluginId,
    });

    // Transform to DiscoverAssistantItem format
    const items: DiscoverAssistantItem[] = (data.items || []).map((item: any) => {
      const normalizedAuthor = normalizeAuthorField(item.author);
      return {
        author:
          normalizedAuthor.name || (item.ownerId !== null ? `User${item.ownerId}` : 'Unknown'),
        avatar: item.avatar || '',
        category: item.category,
        config: {} as any,
        createdAt: item.createdAt || item.updatedAt || new Date().toISOString(),
        description: item.description || '',
        homepage: discoverUrl('assistant', item.identifier),
        identifier: item.identifier,
        installCount: item.installCount,
        knowledgeCount: item.knowledgeCount || 0,
        pluginCount: item.pluginCount || 0,
        schemaVersion: 1,
        tags: item.tags || [],
        title: item.name || item.identifier,
        tokenUsage: item.tokenUsage || 0,
        userName: normalizedAuthor.userName,
      };
    });

    const result: AssistantListResponse = {
      currentPage: data.currentPage || page,
      items,
      pageSize: data.pageSize || pageSize,
      totalCount: data.totalCount || 0,
      totalPages: data.totalPages || 0,
    };

    log(
      'getAgentsByPlugin: returning page %d/%d with %d items',
      result.currentPage,
      result.totalPages,
      result.items.length,
    );
    return result;
  } catch (error) {
    log('getAgentsByPlugin: error fetching from market SDK: %O', error);
    return {
      currentPage: page,
      items: [],
      pageSize,
      totalCount: 0,
      totalPages: 0,
    };
  }
};
