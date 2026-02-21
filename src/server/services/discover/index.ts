import {
  CURRENT_VERSION,
  DEFAULT_DISCOVER_ASSISTANT_ITEM,
  DEFAULT_DISCOVER_PLUGIN_ITEM,
  DEFAULT_DISCOVER_PROVIDER_ITEM,
  isDesktop,
  KLAVIS_SERVER_TYPES,
} from '@lobechat/const';
import {
  type AgentStatus,
  type AssistantListResponse,
  type AssistantMarketSource,
  type AssistantQueryParams,
  type DiscoverAssistantDetail,
  type DiscoverAssistantItem,
  type DiscoverMcpDetail,
  type DiscoverModelDetail,
  type DiscoverModelItem,
  type DiscoverPluginDetail,
  type DiscoverPluginItem,
  type DiscoverProviderDetail,
  type DiscoverProviderItem,
  type DiscoverUserProfile,
  type IdentifiersResponse,
  type McpListResponse,
  type McpQueryParams,
  type ModelListResponse,
  type ModelQueryParams,
  type PluginListResponse,
  type PluginQueryParams,
  type ProviderListResponse,
  type ProviderQueryParams,
} from '@lobechat/types';
import {
  AssistantCategory,
  AssistantSorts,
  CacheRevalidate,
  CacheTag,
  McpCategory,
  McpSorts,
  ModelSorts,
  PluginSorts,
  ProviderSorts,
} from '@lobechat/types';
import {
  getAudioInputUnitRate,
  getTextInputUnitRate,
  getTextOutputUnitRate,
} from '@lobechat/utils';
import {
  type CategoryItem,
  type CategoryListQuery,
  type MarketSDK,
  type UserInfoResponse,
} from '@lobehub/market-sdk';
import {
  type AgentEventRequest,
  type CallReportRequest,
  type InstallReportRequest,
  type PluginEventRequest,
} from '@lobehub/market-types';
import dayjs from 'dayjs';
import debug from 'debug';
import { cloneDeep, countBy, isString, merge, uniq, uniqBy } from 'es-toolkit/compat';
import matter from 'gray-matter';
import urlJoin from 'url-join';

import { type TrustedClientUserInfo } from '@/libs/trusted-client';
import { normalizeLocale } from '@/locales/resources';
import { AssistantStore } from '@/server/modules/AssistantStore';
import { PluginStore } from '@/server/modules/PluginStore';
import { MarketService } from '@/server/services/market';

const log = debug('lobe-server:discover');

export interface DiscoverServiceOptions {
  /** Access token from OIDC flow (legacy) */
  accessToken?: string;
  /** User info for generating trusted client token */
  userInfo?: TrustedClientUserInfo;
}

export class DiscoverService {
  assistantStore = new AssistantStore();
  pluginStore = new PluginStore();
  market: MarketSDK;

  constructor(options: DiscoverServiceOptions = {}) {
    const { accessToken, userInfo } = options;

    // Use MarketService to initialize MarketSDK
    const marketService = new MarketService({ accessToken, userInfo });
    this.market = marketService.market;

    log(
      'DiscoverService initialized with market baseURL: %s, hasAuth: %s, userId: %s',
      process.env.NEXT_PUBLIC_MARKET_BASE_URL,
      !!(accessToken || userInfo),
      userInfo?.userId,
    );
  }

  async registerClient({ userAgent }: { userAgent?: string }) {
    const getDeviceId = async (): Promise<string> => {
      // 1. Use VERCEL_PROJECT_ID in Vercel environment
      if (process.env.VERCEL_PROJECT_ID) {
        return process.env.VERCEL_PROJECT_ID;
      }

      // 2. Use machine-id for desktop
      if (isDesktop) {
        try {
          // Dynamic import
          const { machineId } = await import('node-machine-id');
          return await machineId();
        } catch (error) {
          console.error('Failed to get machine-id:', error);
        }
      }

      return 'unknown-device';
    };

    const deviceId = await getDeviceId();

    const { client_id, client_secret } = await this.market.registerClient({
      clientName: `LobeHub ${isDesktop ? 'Desktop' : 'Web'}`,
      clientType: isDesktop ? 'desktop' : 'web',
      deviceId,
      platform: isDesktop ? process.platform : userAgent,
      version: CURRENT_VERSION,
    });

    return { clientId: client_id, clientSecret: client_secret };
  }

  async fetchM2MToken(params: { clientId: string; clientSecret: string }) {
    // Use MarketService with M2M credentials
    const marketService = new MarketService({
      clientCredentials: params,
    });

    const tokenInfo = await marketService.fetchM2MToken();

    return {
      accessToken: tokenInfo.accessToken,
      expiresIn: tokenInfo.expiresIn,
    };
  }

  // ============================== Call Cloud Mcp Endpoint Methods ==============================

  async callCloudMcpEndpoint(params: {
    apiParams: Record<string, any>;
    identifier: string;
    toolName: string;
    userAccessToken?: string;
  }) {
    log('callCloudMcpEndpoint: params=%O', {
      apiParams: params.apiParams,
      hasUserAccessToken: !!params.userAccessToken,
      identifier: params.identifier,
      toolName: params.toolName,
    });

    try {
      // Build headers - only include Authorization if userAccessToken is provided
      // When userAccessToken is not provided, MarketSDK will use trustedClientToken for authentication
      const headers: Record<string, string> = {};
      if (params.userAccessToken) {
        headers.Authorization = `Bearer ${params.userAccessToken}`;
      }

      // Call cloud gateway with optional user access token in Authorization header
      const result = await this.market.plugins.callCloudGateway(
        {
          apiParams: params.apiParams,
          identifier: params.identifier,
          toolName: params.toolName,
        },
        {
          headers,
        },
      );

      log('callCloudMcpEndpoint: success, result=%O', result);
      return result;
    } catch (error) {
      log('callCloudMcpEndpoint: error=%O', error);
      throw error;
    }
  }

  // ============================== Helper Methods ==============================

  /**
   * Calculate ModelAbilities completeness score
   * Higher score indicates more complete abilities
   */
  private calculateAbilitiesScore = (abilities?: any): number => {
    if (!abilities) return 0;

    let score = 0;
    const abilityWeights = {
      files: 1,
      functionCall: 1,
      imageOutput: 1,
      reasoning: 1,
      search: 1,
      vision: 1,
    };

    Object.entries(abilityWeights).forEach(([ability, weight]) => {
      if (abilities[ability]) {
        score += weight;
      }
    });

    log('calculateAbilitiesScore: abilities=%O, score=%d', abilities, score);
    return score;
  };

  /**
   * Select the model with the most complete abilities from model array
   * Combines the most complete abilities and largest contextWindowTokens
   */
  private selectModelWithBestAbilities = (models: DiscoverModelItem[]): DiscoverModelItem => {
    log('selectModelWithBestAbilities: input models count=%d', models.length);
    if (models.length === 1) return models[0];

    // Find the most complete abilities
    let bestAbilities: Record<string, boolean> = {};
    let maxAbilitiesScore = 0;
    models.forEach((model) => {
      const score = this.calculateAbilitiesScore(model.abilities);
      if (score > maxAbilitiesScore) {
        maxAbilitiesScore = score;
        bestAbilities = { ...(model.abilities as Record<string, boolean>) };
      } else if (score === maxAbilitiesScore && model.abilities) {
        // Merge abilities with the same score to ensure the most complete combination
        const abilities = model.abilities as Record<string, boolean>;
        Object.keys(abilities).forEach((key) => {
          if (abilities[key]) {
            bestAbilities[key] = true;
          }
        });
      }
    });

    // Find the largest contextWindowTokens
    const maxContextWindowTokens = Math.max(
      ...models.map((model) => model.contextWindowTokens || 0),
    );

    // Find the latest releasedAt
    const latestReleasedAt = models
      .map((model) => model.releasedAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0];

    // Find the shortest identifier
    const shortestIdentifier = models
      .map((model) => model.identifier)
      .reduce((shortest, current) => (current.length < shortest.length ? current : shortest));

    // Select a base model (usually the first one)
    const baseModel = models[0];

    // Assemble final model using the best attributes
    const result: DiscoverModelItem = {
      ...baseModel,
      abilities: bestAbilities as any,
      contextWindowTokens: maxContextWindowTokens || baseModel.contextWindowTokens,
      identifier: shortestIdentifier,
      releasedAt: latestReleasedAt || baseModel.releasedAt,
    };

    log('selectModelWithBestAbilities: selected model=%O', {
      abilities: result.abilities,
      contextWindowTokens: result.contextWindowTokens,
      identifier: result.identifier,
      releasedAt: result.releasedAt,
    });
    return result;
  };

  private normalizeAuthorField = (author: unknown): { name: string; userName?: string } => {
    if (!author) return { name: '' };

    if (typeof author === 'string') return { name: author };

    if (typeof author === 'object') {
      const { avatar, url, name, userName } = author as {
        avatar?: unknown;
        name?: unknown;
        url?: unknown;
        userName?: unknown;
      };

      const authorName =
        (typeof name === 'string' && name.length > 0 && name) ||
        (typeof avatar === 'string' && avatar.length > 0 && avatar) ||
        (typeof url === 'string' && url.length > 0 && url) ||
        '';

      return {
        name: authorName,
        userName: typeof userName === 'string' ? userName : undefined,
      };
    }

    return { name: '' };
  };

  private isLegacySource = (source?: AssistantMarketSource) => source === 'legacy';

  private legacyGetAssistantListRaw = async (locale?: string): Promise<DiscoverAssistantItem[]> => {
    log('legacyGetAssistantListRaw: locale=%s', locale);
    const normalizedLocale = normalizeLocale(locale);
    const list = await this.assistantStore.getAgentIndex(normalizedLocale);
    if (!list || !Array.isArray(list)) {
      log('legacyGetAssistantListRaw: no valid list found, returning empty array');
      return [];
    }
    const result = list.map(({ meta, ...item }) => ({ ...item, ...meta }));
    log('legacyGetAssistantListRaw: returning %d items', result.length);
    return result;
  };

  private legacyGetAssistantCategories = async (
    params: CategoryListQuery = {},
  ): Promise<CategoryItem[]> => {
    log('legacyGetAssistantCategories: params=%O', params);
    const { q, locale } = params;
    let list = await this.legacyGetAssistantListRaw(locale);
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
        'legacyGetAssistantCategories: filtered by query "%s", %d -> %d items',
        q,
        originalCount,
        list.length,
      );
    }
    const categoryCounts = countBy(list, (item) => item.category);
    const result = Object.entries(categoryCounts)
      .filter(([category]) => Boolean(category))
      .map(([category, count]) => ({
        category,
        count,
      }));
    log('legacyGetAssistantCategories: returning %d categories', result.length);
    return result;
  };

  private legacyGetAssistantDetail = async (params: {
    identifier: string;
    locale?: string;
    version?: string;
  }): Promise<DiscoverAssistantDetail | undefined> => {
    log('legacyGetAssistantDetail: params=%O', params);
    const { locale, identifier } = params;
    const normalizedLocale = normalizeLocale(locale);
    const data = await this.assistantStore.getAgent(identifier, normalizedLocale);
    if (!data) {
      log('legacyGetAssistantDetail: assistant not found for identifier=%s', identifier);
      return;
    }
    const { meta, ...item } = data;
    const assistant = merge(cloneDeep(DEFAULT_DISCOVER_ASSISTANT_ITEM), { ...item, ...meta });
    const list = await this.getAssistantList({
      category: assistant.category,
      includeAgentGroup: true,
      locale,
      page: 1,
      pageSize: 7,
      source: 'legacy',
    });
    const result = {
      ...assistant,
      related: list.items.filter((item) => item.identifier !== assistant.identifier).slice(0, 6),
    };
    log(
      'legacyGetAssistantDetail: returning assistant with %d related items',
      result.related.length,
    );
    return result;
  };

  private legacyGetAssistantIdentifiers = async (): Promise<IdentifiersResponse> => {
    log('legacyGetAssistantIdentifiers: fetching identifiers');
    const list = await this.legacyGetAssistantListRaw();
    const result = list.map((item) => {
      return {
        identifier: item.identifier,
        lastModified: item.createdAt,
      };
    });
    log('legacyGetAssistantIdentifiers: returning %d identifiers', result.length);
    return result;
  };

  private legacyGetAssistantList = async (
    params: AssistantQueryParams = {},
  ): Promise<AssistantListResponse> => {
    log('legacyGetAssistantList: params=%O', params);
    const {
      locale,
      category,
      order = 'desc',
      page = 1,
      pageSize = 20,
      q,
      sort = AssistantSorts.Recommended,
      ownerId,
    } = params;
    const currentPage = Number(page) || 1;
    const currentPageSize = Number(pageSize) || 20;

    if (ownerId) {
      log('legacyGetAssistantList: ownerId filter not supported in legacy source');
      return {
        currentPage,
        items: [],
        pageSize: currentPageSize,
        totalCount: 0,
        totalPages: 0,
      };
    }

    let list = await this.legacyGetAssistantListRaw(locale);
    const originalCount = list.length;

    if (category) {
      list = list.filter((item) => item.category === category);
      log(
        'legacyGetAssistantList: filtered by category "%s", %d -> %d items',
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
      log(
        'legacyGetAssistantList: filtered by query "%s", %d -> %d items',
        q,
        beforeFilter,
        list.length,
      );
    }

    if (sort) {
      log('legacyGetAssistantList: sorting by %s %s', sort, order);
      switch (sort) {
        case AssistantSorts.UpdatedAt: {
          // Legacy source doesn't have updatedAt, fallback to createdAt
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return dayjs(a.createdAt).unix() - dayjs(b.createdAt).unix();
            } else {
              return dayjs(b.createdAt).unix() - dayjs(a.createdAt).unix();
            }
          });
          break;
        }
        default: {
          // Legacy source doesn't support these sorts (MostUsage, HaveSkills, Recommended), keep original order
          break;
        }
      }
    }

    const start = (currentPage - 1) * currentPageSize;
    const end = currentPage * currentPageSize;
    const result = {
      currentPage,
      items: list.slice(start, end),
      pageSize: currentPageSize,
      totalCount: list.length,
      totalPages: Math.ceil(list.length / currentPageSize),
    };
    log(
      'legacyGetAssistantList: returning page %d/%d with %d items',
      currentPage,
      result.totalPages,
      result.items.length,
    );
    return result;
  };

  // ============================== Assistant Market ==============================

  getAssistantCategories = async (
    params: CategoryListQuery & { source?: AssistantMarketSource } = {},
  ): Promise<CategoryItem[]> => {
    log('getAssistantCategories: params=%O', params);
    const { source, ...rest } = params;
    if (this.isLegacySource(source)) {
      return this.legacyGetAssistantCategories(rest);
    }

    const { q, locale } = rest;
    const normalizedLocale = normalizeLocale(locale);

    try {
      // @ts-ignore
      const categories = await this.market.agents.getCategories({
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

  getAssistantDetail = async (params: {
    identifier: string;
    locale?: string;
    source?: AssistantMarketSource;
    version?: string;
  }): Promise<DiscoverAssistantDetail | undefined> => {
    log('getAssistantDetail: params=%O', params);
    const { source, ...rest } = params;
    if (this.isLegacySource(source)) {
      return this.legacyGetAssistantDetail(rest);
    }

    const { locale, identifier, version } = rest;
    const normalizedLocale = normalizeLocale(locale);

    try {
      // @ts-ignore
      const data = await this.market.agents.getAgentDetail(identifier, {
        locale: normalizedLocale,
        version,
      });

      if (!data) {
        log('getAssistantDetail: assistant not found for identifier=%s', identifier);
        return;
      }

      const normalizedAuthor = this.normalizeAuthorField(data.author);
      const assistant = {
        author:
          normalizedAuthor.name || (data.ownerId !== null ? `User${data.ownerId}` : 'Unknown'),
        avatar: data.avatar || normalizedAuthor.name || '',
        category: (data as any).category || 'general',
        config: data.config || {},
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
        homepage:
          (data as any).homepage ||
          `https://lobehub.com/discover/assistant/${(data as any).identifier}`,
        identifier: (data as any).identifier,
        isValidated: (data as any).isValidated,
        knowledgeCount:
          (data.config as any)?.knowledgeBases?.length || (data as any).knowledgeCount || 0,
        pluginCount: (data.config as any)?.plugins?.length || (data as any).pluginCount || 0,
        readme: data.documentationUrl || '',
        schemaVersion: 1,
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
      const list = await this.getAssistantList({
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
      return;
    }
  };

  getAssistantIdentifiers = async (
    params: { source?: AssistantMarketSource } = {},
  ): Promise<IdentifiersResponse> => {
    log('getAssistantIdentifiers: fetching identifiers with params=%O', params);
    if (this.isLegacySource(params.source)) {
      return this.legacyGetAssistantIdentifiers();
    }

    try {
      // @ts-ignore
      const identifiers = await this.market.agents.getPublishedIdentifiers();
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

  getAssistantList = async (params: AssistantQueryParams = {}): Promise<AssistantListResponse> => {
    log('getAssistantList: params=%O', params);
    const { source, ...rest } = params;
    if (this.isLegacySource(source)) {
      return this.legacyGetAssistantList(rest);
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

      const data = await this.market.agents.getAgentList({
        category: shouldOmitCategory ? undefined : category,
        haveSkills,
        // includeAgentGroup may not be in SDK type definition yet, using 'as any'
        includeAgentGroup,
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
        const normalizedAuthor = this.normalizeAuthorField(item.author);
        return {
          author:
            normalizedAuthor.name || (item.ownerId !== null ? `User${item.ownerId}` : 'Unknown'),
          avatar: item.avatar || normalizedAuthor.name || '',
          category: item.category || 'general',
          config: item.config || {},
          createdAt: item.createdAt || item.updatedAt || new Date().toISOString(),
          description: item.description || item.summary || '',
          forkCount: item.forkCount,
          homepage: item.homepage || `https://lobehub.com/discover/assistant/${item.identifier}`,
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
      return {
        currentPage: page,
        items: [],
        pageSize,
        totalCount: 0,
        totalPages: 0,
      };
    }
  };

  // ============================== MCP Market ==============================

  getMcpCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    log('getMcpCategories: params=%O', params);
    const { locale } = params;
    const normalizedLocale = normalizeLocale(locale);
    const result = await this.market.plugins.getCategories(
      {
        ...params,
        locale: normalizedLocale,
      },
      {
        next: {
          revalidate: 3600,
        },
      },
    );
    log('getMcpCategories: returning %d categories', result.length);
    return result;
  };

  getMcpDetail = async (params: {
    identifier: string;
    locale?: string;
    version?: string;
  }): Promise<DiscoverMcpDetail> => {
    log('getMcpDetail: params=%O', params);
    const { locale } = params;
    const normalizedLocale = normalizeLocale(locale);
    const mcp = await this.market.plugins.getPluginDetail(
      { ...params, locale: normalizedLocale },
      {
        next: {
          revalidate: 3600,
        },
      },
    );

    // Fetch related MCPs
    const list = await this.getMcpList({
      category: mcp.category,
      locale,
      page: 1,
      pageSize: 7,
    });

    const result = {
      ...mcp,
      related: list.items.filter((item) => item.identifier !== mcp.identifier).slice(0, 6),
    };
    log('getMcpDetail: returning mcp with %d related items', result.related.length);
    return result;
  };

  getMcpList = async (params: McpQueryParams = {}): Promise<McpListResponse> => {
    log('getMcpList: params=%O', params);
    const { category, locale, sort } = params;
    const normalizedLocale = normalizeLocale(locale);
    const shouldOmitCategory = [McpCategory.All, McpCategory.Discover].includes(
      category as McpCategory,
    );

    const result = await this.market.plugins.getPluginList(
      {
        ...params,
        category: shouldOmitCategory ? undefined : category,
        locale: normalizedLocale,
        sort: shouldOmitCategory ? McpSorts.Recommended : sort,
      },
      {
        next: {
          revalidate: CacheRevalidate.List,
          tags: [CacheTag.Discover, CacheTag.MCP],
        },
      },
    );
    log('getMcpList: returning %d items on page %d', result.items.length, result.currentPage);
    return result;
  };

  getMcpManifest = async (params: { identifier: string; locale?: string; version?: string }) => {
    log('getMcpManifest: params=%O', params);
    const { locale } = params;
    const normalizedLocale = normalizeLocale(locale);
    const result = await this.market.plugins.getPluginManifest(
      {
        ...params,
        locale: normalizedLocale,
      },
      {
        next: {
          revalidate: CacheRevalidate.List,
          tags: [CacheTag.Discover, CacheTag.MCP],
        },
      },
    );
    log('getMcpManifest: returning manifest for %s', params.identifier);
    return result;
  };

  // ============================== MCP Analytics ==============================

  /**
   * report MCP plugin result marketplace
   */
  reportPluginInstallation = async (params: InstallReportRequest) => {
    await this.market.plugins.reportInstallation(params);
  };

  /**
   * record Agent plugin event
   */
  createAgentEvent = async (params: AgentEventRequest) => {
    await this.market.agents.createEvent(params);
  };

  /**
   * record MCP plugin event
   */
  createPluginEvent = async (params: PluginEventRequest) => {
    await this.market.plugins.createEvent(params);
  };

  /**
   * report plugin call result to marketplace
   */
  reportCall = async (params: CallReportRequest) => {
    await this.market.plugins.reportCall(params);
  };

  // ============================== Agent Analytics ==============================

  /**
   * Increase agent install count in marketplace
   */
  increaseAgentInstallCount = async (identifier: string) => {
    await this.market.agents.increaseInstallCount(identifier);
  };

  /**
   * Get agents that use a specific plugin
   */
  getAgentsByPlugin = async (params: {
    locale?: string;
    page?: number;
    pageSize?: number;
    pluginId: string;
  }): Promise<AssistantListResponse> => {
    log('getAgentsByPlugin: params=%O', params);
    const { locale, pluginId, page = 1, pageSize = 20 } = params;
    const normalizedLocale = normalizeLocale(locale);

    try {
      const data = await this.market.agents.getAgentsByPlugin({
        locale: normalizedLocale,
        page,
        pageSize,
        pluginId,
      });

      // Transform to DiscoverAssistantItem format
      const items: DiscoverAssistantItem[] = (data.items || []).map((item: any) => {
        const normalizedAuthor = this.normalizeAuthorField(item.author);
        return {
          author:
            normalizedAuthor.name || (item.ownerId !== null ? `User${item.ownerId}` : 'Unknown'),
          avatar: item.avatar || '',
          category: item.category,
          config: {} as any,
          createdAt: item.createdAt || item.updatedAt || new Date().toISOString(),
          description: item.description || '',
          homepage: `https://lobehub.com/discover/assistant/${item.identifier}`,
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

  // ============================== Plugin Market ==============================

  private _getPluginList = async (locale?: string): Promise<DiscoverPluginItem[]> => {
    log('_getPluginList: locale=%s', locale);
    const normalizedLocale = normalizeLocale(locale);
    const list = await this.pluginStore.getPluginList(normalizedLocale);
    if (!list || !Array.isArray(list)) {
      log('_getPluginList: no valid list found, returning empty array');
      return [];
    }
    const result = list.map(({ meta, ...item }) => ({ ...item, ...meta }));
    log('_getPluginList: returning %d items', result.length);
    return result;
  };

  getLegacyPluginList = async ({ locale }: { locale?: string } = {}): Promise<any> => {
    log('getLegacyPluginList: locale=%s', locale);
    const normalizedLocale = normalizeLocale(locale);
    const result = await this.pluginStore.getPluginList(normalizedLocale);
    log('getLegacyPluginList: returning plugin list');
    return result;
  };

  getPluginCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    log('getPluginCategories: params=%O', params);
    const { q, locale } = params;
    let list = await this._getPluginList(locale);
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

  getPluginDetail = async (params: {
    identifier: string;
    locale?: string;
    withManifest?: boolean;
  }): Promise<DiscoverPluginDetail | undefined> => {
    log('getPluginDetail: params=%O', params);
    const { locale, identifier, withManifest } = params;

    // Step 1: Try to find in legacy plugin list
    const all = await this._getPluginList(locale);
    const raw = all.find((item) => item.identifier === identifier);
    if (raw) {
      log('getPluginDetail: found plugin in legacy list for identifier=%s', identifier);
      const mergedRaw = merge(cloneDeep(DEFAULT_DISCOVER_PLUGIN_ITEM), raw);
      const list = await this.getPluginList({
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
      const mcpDetail = await this.getMcpDetail({ identifier, locale });
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
    } catch {
      log(
        'getPluginDetail: MCP plugin not found for identifier=%s, trying builtin tools',
        identifier,
      );
    }

    // Step 3: Try to find in builtin tools
    const { builtinTools } = await import('@/tools/index');
    const builtinTool = builtinTools.find((tool) => tool.identifier === identifier);
    if (builtinTool) {
      log('getPluginDetail: found builtin tool for identifier=%s', identifier);
      const plugin: DiscoverPluginDetail = {
        author: 'LobeHub',
        avatar: builtinTool.manifest.meta.avatar || '',
        category: undefined,
        createdAt: '',
        description: builtinTool.manifest.meta.description || '',
        homepage: 'https://lobehub.com',
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

    // Step 4: Try to find in Klavis server types (builtin tools that require env config)
    const klavisTool = KLAVIS_SERVER_TYPES.find((tool) => tool.identifier === identifier);
    if (klavisTool) {
      log('getPluginDetail: found Klavis tool for identifier=%s', identifier);

      // Avatar is empty here because frontend will render Klavis icons using KlavisIcon component
      // which handles both string URLs and React component icons
      const plugin: DiscoverPluginDetail = {
        author: 'Klavis',
        avatar: typeof klavisTool.icon === 'string' ? klavisTool.icon : '',
        category: undefined,
        createdAt: '',
        description: `LobeHub Mcp Server: ${klavisTool.label}`,
        homepage: 'https://klavis.ai',
        identifier: klavisTool.identifier,
        manifest: undefined,
        related: [],
        schemaVersion: 1,
        source: 'builtin',
        tags: ['klavis', 'mcp'],
        title: klavisTool.label,
      };
      log('getPluginDetail: returning Klavis tool plugin');
      return plugin;
    }

    log('getPluginDetail: plugin not found anywhere for identifier=%s', identifier);
    return;
  };

  getPluginIdentifiers = async (): Promise<IdentifiersResponse> => {
    log('getPluginIdentifiers: fetching identifiers');
    const list = await this._getPluginList();
    const result = list.map((item) => {
      return {
        identifier: item.identifier,
        lastModified: item.createdAt,
      };
    });
    log('getPluginIdentifiers: returning %d identifiers', result.length);
    return result;
  };

  getPluginList = async (params: PluginQueryParams = {}): Promise<PluginListResponse> => {
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

    let list = await this._getPluginList(locale);
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

  // ============================== Providers ==============================

  private _getProviderList = async (): Promise<DiscoverProviderItem[]> => {
    log('_getProviderList: fetching provider list');
    const [{ LOBE_DEFAULT_MODEL_LIST }, { DEFAULT_MODEL_PROVIDER_LIST }] = await Promise.all([
      import('model-bank'),
      import('model-bank/modelProviders'),
    ]);
    const result = DEFAULT_MODEL_PROVIDER_LIST.map((item) => {
      const models = uniq(
        LOBE_DEFAULT_MODEL_LIST.filter((m) => m.providerId === item.id).map((m) => m.id),
      );
      const provider = {
        ...item,
        identifier: item.id,
        modelCount: models.length,
        models,
      };
      return merge(cloneDeep(DEFAULT_DISCOVER_PROVIDER_ITEM), provider);
    });
    log('_getProviderList: returning %d providers', result.length);
    return result;
  };

  getProviderDetail = async (params: {
    identifier: string;
    locale?: string;
    withReadme?: boolean;
  }): Promise<DiscoverProviderDetail | undefined> => {
    log('getProviderDetail: params=%O', params);
    const { identifier, locale, withReadme } = params;
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');
    const all = await this._getProviderList();
    const provider = all.find((item) => item.identifier === identifier);
    if (!provider) {
      log('getProviderDetail: provider not found for identifier=%s', identifier);
      return;
    }

    const list = await this.getProviderList({
      page: 1,
      pageSize: 7,
    });

    let readme;

    if (withReadme) {
      log('getProviderDetail: fetching readme for provider=%s', identifier);
      try {
        const normalizedLocale = normalizeLocale(locale);
        const readmeUrl = urlJoin(
          'https://raw.githubusercontent.com/lobehub/lobe-chat/refs/heads/main/docs/usage/providers',
          normalizedLocale === 'zh-CN' ? `${identifier}.zh-CN.mdx` : `${identifier}.mdx`,
        );
        log('getProviderDetail: readme URL=%s', readmeUrl);
        const res = await fetch(readmeUrl, {
          next: {
            tags: [CacheTag.Discover, CacheTag.Providers],
          },
        });

        const data = await res.text();
        const { content } = matter(data);
        readme = content.trimEnd();
        log('getProviderDetail: readme loaded successfully, length=%d', readme.length);
      } catch (error) {
        log(
          'getProviderDetail: failed to load readme for provider=%s, error: %O',
          identifier,
          error,
        );
      }
    }

    const result = {
      ...provider,
      models: uniqBy(
        LOBE_DEFAULT_MODEL_LIST.filter((m) => m.providerId === provider.id),
        (item) => item.id,
      ),
      readme,
      related: list.items.filter((item) => item.identifier !== provider.identifier).slice(0, 6),
    };
    log(
      'getProviderDetail: returning provider with %d models and %d related items',
      result.models.length,
      result.related.length,
    );
    return result;
  };

  getProviderIdentifiers = async (): Promise<IdentifiersResponse> => {
    log('getProviderIdentifiers: fetching identifiers');
    const list = await this._getProviderList();
    const result = list.map((item) => {
      return {
        identifier: item.identifier,
        lastModified: dayjs().toISOString(),
      };
    });
    log('getProviderIdentifiers: returning %d identifiers', result.length);
    return result;
  };

  getProviderList = async (params: ProviderQueryParams = {}): Promise<ProviderListResponse> => {
    log('getProviderList: params=%O', params);
    const { page = 1, pageSize = 20, q, sort = ProviderSorts.Default, order = 'desc' } = params;
    let list = await this._getProviderList();
    const originalCount = list.length;

    if (q) {
      list = list.filter((item) => {
        return [item.identifier, item.description, item.name]
          .filter(Boolean)
          .join(',')
          .toLowerCase()
          .includes(decodeURIComponent(q).toLowerCase());
      });
      log('getProviderList: filtered by query "%s", %d -> %d items', q, originalCount, list.length);
    }

    if (sort) {
      log('getProviderList: sorting by %s %s', sort, order);
      switch (sort) {
        case ProviderSorts.Identifier: {
          list = list.sort((a, b) => {
            if (order === 'desc') {
              return a.identifier.localeCompare(b.identifier);
            } else {
              return b.identifier.localeCompare(a.identifier);
            }
          });
          break;
        }
        case ProviderSorts.ModelCount: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return a.modelCount - b.modelCount;
            } else {
              return b.modelCount - a.modelCount;
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
      'getProviderList: returning page %d/%d with %d items',
      page,
      result.totalPages,
      result.items.length,
    );
    return result;
  };

  // ============================== Models ==============================

  private _getRawModelList = async (): Promise<DiscoverModelItem[]> => {
    log('_getRawModelList: fetching raw model list');
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');
    const result = LOBE_DEFAULT_MODEL_LIST.map((item) => {
      const identifier = (item.id.split('/').at(-1) || item.id).toLowerCase();
      const providers = uniq(
        LOBE_DEFAULT_MODEL_LIST.filter(
          (m) =>
            m.id.toLowerCase() === identifier ||
            m.id.includes(`/${identifier}`) ||
            m.displayName?.toLowerCase() === item.displayName?.toLowerCase(),
        ).map((m) => m.providerId),
      );
      const model = {
        ...item,
        category: item.providerId,
        identifier,
        providerCount: providers.length,
        providers,
      };
      // Use simple merge instead of DEFAULT_DISCOVER_MODEL_ITEM to avoid type conflicts
      return {
        ...model,
        abilities: model.abilities || {},
      } as DiscoverModelItem;
    });
    log('_getRawModelList: returning %d raw models', result.length);
    return result;
  };

  private _getModelList = async (category?: string): Promise<DiscoverModelItem[]> => {
    log('_getModelList: category=%s', category);
    let list = await this._getRawModelList();
    const originalCount = list.length;

    if (category) {
      list = list.filter((item) => item.providerId === category);
      log(
        '_getModelList: filtered by category "%s", %d -> %d items',
        category,
        originalCount,
        list.length,
      );
    }

    // Optimize deduplication logic: select models with most complete abilities
    // 1. Group by identifier
    const identifierGroups = new Map<string, DiscoverModelItem[]>();
    list.forEach((item) => {
      const key = item.identifier;
      if (!identifierGroups.has(key)) {
        identifierGroups.set(key, []);
      }
      identifierGroups.get(key)!.push(item);
    });

    log(
      '_getModelList: grouped %d items into %d identifier groups',
      list.length,
      identifierGroups.size,
    );

    // 2. Select the model with most complete abilities from each identifier group
    const deduplicatedByIdentifier = Array.from(identifierGroups.values()).map((models) =>
      this.selectModelWithBestAbilities(models),
    );

    // 3. Group by displayName
    const displayNameGroups = new Map<string, DiscoverModelItem[]>();
    deduplicatedByIdentifier.forEach((item) => {
      const key = item.displayName?.toLowerCase() || '';
      if (!displayNameGroups.has(key)) {
        displayNameGroups.set(key, []);
      }
      displayNameGroups.get(key)!.push(item);
    });

    log(
      '_getModelList: grouped %d items into %d displayName groups',
      deduplicatedByIdentifier.length,
      displayNameGroups.size,
    );

    // 4. Select the model with most complete abilities from each displayName group
    const finalList: DiscoverModelItem[] = Array.from(displayNameGroups.values()).map((models) =>
      this.selectModelWithBestAbilities(models),
    );

    log('_getModelList: returning %d deduplicated models', finalList.length);
    return finalList;
  };

  getModelCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    log('getModelCategories: params=%O', params);
    const { q } = params;
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');
    let list = LOBE_DEFAULT_MODEL_LIST;
    if (q) {
      const originalCount = list.length;
      list = list.filter((item) => {
        return [item.id, item.displayName, item.description]
          .flat()
          .filter(Boolean)
          .join(',')
          .toLowerCase()
          .includes(decodeURIComponent(q).toLowerCase());
      });
      log(
        'getModelCategories: filtered by query "%s", %d -> %d items',
        q,
        originalCount,
        list.length,
      );
    }
    const categoryCounts = countBy(list, (item) => item.providerId);
    const result = Object.entries(categoryCounts)
      .filter(([category]) => Boolean(category)) // Filter out empty values
      .map(([category, count]) => ({
        category,
        count,
      }));
    log('getModelCategories: returning %d categories', result.length);
    return result;
  };

  getModelDetail = async (params: {
    identifier: string;
  }): Promise<DiscoverModelDetail | undefined> => {
    log('getModelDetail: params=%O', params);
    const [{ LOBE_DEFAULT_MODEL_LIST }, { DEFAULT_MODEL_PROVIDER_LIST }] = await Promise.all([
      import('model-bank'),
      import('model-bank/modelProviders'),
    ]);
    const { identifier } = params;
    const all = await this._getModelList();
    let model = all.find((item) => item.identifier.toLowerCase() === identifier.toLowerCase());

    if (!model) {
      log('getModelDetail: model not found in deduplicated list, searching raw list');
      const raw = await this._getRawModelList();
      model = raw.find((item) => item.identifier.toLowerCase() === identifier.toLowerCase());
    }

    if (!model) {
      log('getModelDetail: model not found for identifier=%s', identifier);
      return;
    }

    const providers = DEFAULT_MODEL_PROVIDER_LIST.filter((item) =>
      model.providers?.includes(item.id),
    );
    log('getModelDetail: found %d providers for model %s', providers.length, model.identifier);

    const list = await this.getModelList({
      page: 1,
      pageSize: 7,
      q: model.identifier.split('-')[0],
    });

    const result = {
      ...model,
      providers: providers.map((item) => ({
        ...item,
        model: LOBE_DEFAULT_MODEL_LIST.find((m) => {
          if (m.providerId !== item.id) return false;
          return (
            m.id.toLowerCase() === model.identifier.toLowerCase() ||
            m.id.toLowerCase().includes(`/${model.identifier.toLowerCase()}`) ||
            m.displayName?.toLowerCase() === model.displayName?.toLowerCase()
          );
        }),
      })),
      related: list.items
        .filter(
          (item) => item.identifier !== model.identifier && item.displayName !== model?.displayName,
        )
        .slice(0, 6),
    };
    log(
      'getModelDetail: returning model with %d providers and %d related items',
      result.providers.length,
      result.related.length,
    );
    return result;
  };

  getModelIdentifiers = async (): Promise<IdentifiersResponse> => {
    log('getModelIdentifiers: fetching identifiers');
    const list = await this._getModelList();
    const result = list.map((item) => {
      return {
        identifier: item.identifier,
        lastModified: item.releasedAt || dayjs().toISOString(),
      };
    });
    log('getModelIdentifiers: returning %d identifiers', result.length);
    return result;
  };

  getModelList = async (params: ModelQueryParams = {}): Promise<ModelListResponse> => {
    log('getModelList: params=%O', params);
    const {
      category,
      order = 'desc',
      page = 1,
      pageSize = 20,
      q,
      sort = ModelSorts.ReleasedAt,
    } = params;
    let list = await this._getModelList(category);

    // if (category) {
    //   list = list.filter((item) => item.category === category);
    // }

    if (q) {
      const beforeFilter = list.length;
      list = list.filter((item) => {
        return [item.identifier, item.displayName, item.description]
          .flat()
          .filter(Boolean)
          .join(',')
          .toLowerCase()
          .includes(decodeURIComponent(q).toLowerCase());
      });
      log('getModelList: filtered by query "%s", %d -> %d items', q, beforeFilter, list.length);
    }

    if (sort) {
      log('getModelList: sorting by %s %s', sort, order);
      switch (sort) {
        case ModelSorts.ReleasedAt: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return dayjs(a.releasedAt).unix() - dayjs(b.releasedAt).unix();
            } else {
              return dayjs(b.releasedAt).unix() - dayjs(a.releasedAt).unix();
            }
          });
          break;
        }
        case ModelSorts.Identifier: {
          list = list.sort((a, b) => {
            if (order === 'desc') {
              return a.identifier.localeCompare(b.identifier);
            } else {
              return b.identifier.localeCompare(a.identifier);
            }
          });
          break;
        }
        case ModelSorts.InputPrice: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return (
                (getTextInputUnitRate(a.pricing) || getAudioInputUnitRate(a.pricing) || 0) -
                (getTextInputUnitRate(b.pricing) || getAudioInputUnitRate(b.pricing) || 0)
              );
            } else {
              return (
                (getTextInputUnitRate(b.pricing) || getAudioInputUnitRate(b.pricing) || 0) -
                (getTextInputUnitRate(a.pricing) || getAudioInputUnitRate(a.pricing) || 0)
              );
            }
          });
          break;
        }
        case ModelSorts.OutputPrice: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return (
                (getTextOutputUnitRate(a.pricing) || 0) - (getTextOutputUnitRate(b.pricing) || 0)
              );
            } else {
              return (
                (getTextOutputUnitRate(b.pricing) || 0) - (getTextOutputUnitRate(a.pricing) || 0)
              );
            }
          });
          break;
        }
        case ModelSorts.ContextWindowTokens: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return (a.contextWindowTokens || 0) - (b.contextWindowTokens || 0);
            } else {
              return (b.contextWindowTokens || 0) - (a.contextWindowTokens || 0);
            }
          });
          break;
        }
        case ModelSorts.ProviderCount: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return a.providerCount - b.providerCount;
            } else {
              return b.providerCount - a.providerCount;
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
      'getModelList: returning page %d/%d with %d items',
      page,
      result.totalPages,
      result.items.length,
    );
    return result;
  };

  // ============================== User Profile ==============================

  /**
   * Get user profile and their published agents by username
   */
  getUserInfo = async (params: {
    locale?: string;
    username: string;
  }): Promise<DiscoverUserProfile | undefined> => {
    log('getUserInfo: params=%O', params);
    const { username, locale } = params;

    try {
      // Call Market SDK to get user info
      const response = (await this.market.user.getUserInfo(username, {
        locale,
      })) as UserInfoResponse & {
        agentGroups?: any[];
        favoriteAgentGroups?: any[];
        favoriteAgents?: any[];
        forkedAgentGroups?: any[];
        forkedAgents?: any[];
      };

      if (!response?.user) {
        log('getUserInfo: user not found for username=%s', username);
        return undefined;
      }

      const { user, agents, agentGroups, forkedAgents, forkedAgentGroups, favoriteAgents, favoriteAgentGroups } = response;

      // Transform agents to DiscoverAssistantItem format
      const transformedAgents: DiscoverAssistantItem[] = (agents || []).map((agent: any) => ({
        author: user.displayName || user.userName || user.namespace || '',
        avatar: agent.avatar || '',
        category: agent.category as any,
        config: {} as any,
        createdAt: agent.createdAt,
        description: agent.description || '',
        forkCount: agent.forkCount,
        homepage: `https://lobehub.com/discover/assistant/${agent.identifier}`,
        identifier: agent.identifier,
        installCount: agent.installCount,
        isValidated: agent.isValidated,
        knowledgeCount: agent.knowledgeCount || 0,
        pluginCount: agent.pluginCount || 0,
        schemaVersion: 1,
        status: agent.status,
        tags: agent.tags || [],
        title: agent.name || agent.identifier,
        tokenUsage: agent.tokenUsage || 0,
      }));

      // Transform agentGroups to DiscoverGroupAgentItem format
      const transformedAgentGroups = (agentGroups || []).map((group: any) => ({
        author: user.displayName || user.userName || user.namespace || '',
        avatar: group.avatar || '👥',
        category: group.category as any,
        createdAt: group.createdAt,
        description: group.description || '',
        forkCount: group.forkCount,
        homepage: `https://lobehub.com/discover/group_agent/${group.identifier}`,
        identifier: group.identifier,
        installCount: group.installCount || 0,
        isFeatured: group.isFeatured || false,
        isOfficial: group.isOfficial || false,
        isValidated: group.isValidated,
        memberCount: 0, // Will be populated from memberAgents in detail view
        schemaVersion: 1,
        status: group.status,
        tags: group.tags || [],
        title: group.name || group.identifier,
        updatedAt: group.updatedAt,
      }));

      // Transform forkedAgents to DiscoverAssistantItem format
      const transformedForkedAgents: DiscoverAssistantItem[] = (forkedAgents || []).map(
        (agent: any) => ({
          author: user.displayName || user.userName || user.namespace || '',
          avatar: agent.avatar || '',
          category: agent.category as any,
          config: {} as any,
          createdAt: agent.createdAt,
          description: agent.description || '',
          forkCount: agent.forkCount || 0,
          forkedFromAgentId: agent.forkedFromAgentId || null,
          homepage: `https://lobehub.com/discover/assistant/${agent.identifier}`,
          identifier: agent.identifier,
          installCount: agent.installCount,
          isValidated: agent.isValidated,
          knowledgeCount: agent.knowledgeCount || 0,
          pluginCount: agent.pluginCount || 0,
          schemaVersion: 1,
          status: agent.status,
          tags: agent.tags || [],
          title: agent.name || agent.identifier,
          tokenUsage: agent.tokenUsage || 0,
        }),
      );

      // Transform forkedAgentGroups to DiscoverGroupAgentItem format
      const transformedForkedAgentGroups = (forkedAgentGroups || []).map((group: any) => ({
        author: user.displayName || user.userName || user.namespace || '',
        avatar: group.avatar || '👥',
        category: group.category as any,
        createdAt: group.createdAt,
        description: group.description || '',
        forkCount: group.forkCount || 0,
        forkedFromGroupId: group.forkedFromGroupId || null,
        homepage: `https://lobehub.com/discover/group_agent/${group.identifier}`,
        identifier: group.identifier,
        installCount: group.installCount || 0,
        isFeatured: group.isFeatured || false,
        isOfficial: group.isOfficial || false,
        isValidated: group.isValidated,
        memberCount: 0, // Will be populated from memberAgents in detail view
        schemaVersion: 1,
        status: group.status,
        tags: group.tags || [],
        title: group.name || group.identifier,
        updatedAt: group.updatedAt,
      }));

      // Transform favoriteAgents to DiscoverAssistantItem format
      const transformedFavoriteAgents: DiscoverAssistantItem[] = (favoriteAgents || []).map(
        (agent: any) => ({
          author: agent.author || '',
          avatar: agent.avatar || '',
          category: agent.category as any,
          config: {} as any,
          createdAt: agent.createdAt,
          description: agent.description || '',
          forkCount: agent.forkCount || 0,
          forkedFromAgentId: agent.forkedFromAgentId || null,
          homepage: `https://lobehub.com/discover/assistant/${agent.identifier}`,
          identifier: agent.identifier,
          installCount: agent.installCount,
          isValidated: agent.isValidated,
          knowledgeCount: agent.knowledgeCount || 0,
          pluginCount: agent.pluginCount || 0,
          schemaVersion: 1,
          status: agent.status,
          tags: agent.tags || [],
          title: agent.name || agent.identifier,
          tokenUsage: agent.tokenUsage || 0,
        }),
      );

      // Transform favoriteAgentGroups to DiscoverGroupAgentItem format
      const transformedFavoriteAgentGroups = (favoriteAgentGroups || []).map((group: any) => ({
        author: group.author || '',
        avatar: group.avatar || '👥',
        category: group.category as any,
        createdAt: group.createdAt,
        description: group.description || '',
        forkCount: group.forkCount || 0,
        forkedFromGroupId: group.forkedFromGroupId || null,
        homepage: `https://lobehub.com/discover/group_agent/${group.identifier}`,
        identifier: group.identifier,
        installCount: group.installCount || 0,
        isFeatured: group.isFeatured || false,
        isOfficial: group.isOfficial || false,
        isValidated: group.isValidated,
        memberCount: 0, // Will be populated from memberAgents in detail view
        schemaVersion: 1,
        status: group.status,
        tags: group.tags || [],
        title: group.name || group.identifier,
        updatedAt: group.updatedAt,
      }));

      const result: DiscoverUserProfile = {
        agentGroups: transformedAgentGroups,
        agents: transformedAgents,
        favoriteAgentGroups: transformedFavoriteAgentGroups,
        favoriteAgents: transformedFavoriteAgents,
        forkedAgentGroups: transformedForkedAgentGroups,
        forkedAgents: transformedForkedAgents,
        user: {
          avatarUrl: user.avatarUrl || null,
          bannerUrl: user.meta?.bannerUrl || null,
          createdAt: user.createdAt,
          description: user.meta?.description || null,
          displayName: user.displayName || null,
          followersCount: user.followerCount ?? 0,
          followingCount: user.followingCount ?? 0,
          id: user.id,
          namespace: user.namespace,
          socialLinks: user.meta?.socialLinks || null,
          type: user.type || null,
          userName: user.userName || null,
        },
      };

      log(
        'getUserInfo: returning user profile with %d agents, %d groups, %d forked agents, %d forked groups, %d favorite agents, %d favorite groups',
        result.agents.length,
        result.agentGroups?.length || 0,
        result.forkedAgents?.length || 0,
        result.forkedAgentGroups?.length || 0,
        result.favoriteAgents?.length || 0,
        result.favoriteAgentGroups?.length || 0,
      );
      return result;
    } catch (error) {
      log('getUserInfo: error fetching user info: %O', error);
      return undefined;
    }
  };

  // ============================== Group Agent Market Methods ==============================

  getGroupAgentCategories = async (params?: CategoryListQuery) => {
    try {
      // TODO: SDK method not yet available, using fallback
      const response = await (this.market.agentGroups as any).getAgentGroupCategories?.(params);
      return response || { items: [] };
    } catch (error) {
      log('getGroupAgentCategories: error: %O', error);
      return { items: [] };
    }
  };

  getGroupAgentDetail = async (params: {
    identifier: string;
    locale?: string;
    version?: string;
  }) => {
    try {
      const response = await this.market.agentGroups.getAgentGroupDetail(params.identifier, {
        locale: params.locale,
        version: params.version ? Number(params.version) : undefined,
      });
      return response;
    } catch (error) {
      log('getGroupAgentDetail: error: %O', error);
      throw error;
    }
  };

  getGroupAgentIdentifiers = async () => {
    try {
      // TODO: SDK method not yet available, using fallback
      const response = await (this.market.agentGroups as any).getAgentGroupIdentifiers?.();
      return response || { identifiers: [] };
    } catch (error) {
      log('getGroupAgentIdentifiers: error: %O', error);
      return { identifiers: [] };
    }
  };

  getGroupAgentList = async (params?: {
    category?: string;
    locale?: string;
    order?: 'asc' | 'desc';
    ownerId?: string;
    page?: number;
    pageSize?: number;
    q?: string;
    sort?: 'createdAt' | 'updatedAt' | 'name' | 'recommended';
  }) => {
    try {
      const response = await this.market.agentGroups.getAgentGroupList({
        ...params,
        status: 'published' as any,
        visibility: 'public' as any,
      });
      return response;
    } catch (error) {
      log('getGroupAgentList: error: %O', error);
      return { currentPage: 1, items: [], totalCount: 0, totalPages: 1 };
    }
  };

  createGroupAgentEvent = async (params: {
    event: 'add' | 'chat' | 'click';
    identifier: string;
    source?: string;
  }) => {
    try {
      // TODO: SDK method not yet available
      await (this.market.agentGroups as any).createAgentGroupEvent?.(params);
    } catch (error) {
      log('createGroupAgentEvent: error: %O', error);
    }
  };

  increaseGroupAgentInstallCount = async (identifier: string) => {
    try {
      // TODO: SDK method not yet available
      await (this.market.agentGroups as any).increaseInstallCount?.(identifier);
    } catch (error) {
      log('increaseGroupAgentInstallCount: error: %O', error);
    }
  };
}
