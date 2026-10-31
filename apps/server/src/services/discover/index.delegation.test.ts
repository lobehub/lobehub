// @vitest-environment node
import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import { AssistantCategory, AssistantSorts, McpCategory, McpSorts } from '@lobechat/types';
import { MarketAPIError } from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoverService } from './index';

const { fetchM2MToken, getAgent, getPluginList, market, marketServiceOptions } = vi.hoisted(() => ({
  fetchM2MToken: vi.fn(),
  getAgent: vi.fn(),
  getPluginList: vi.fn(),
  market: {
    agentGroups: {
      createAgentGroupEvent: vi.fn(),
      getAgentGroupCategories: vi.fn(),
      getAgentGroupDetail: vi.fn(),
      getAgentGroupIdentifiers: vi.fn(),
      getAgentGroupList: vi.fn(),
      increaseInstallCount: vi.fn(),
    },
    agents: {
      createEvent: vi.fn(),
      getAgentDetail: vi.fn(),
      getAgentList: vi.fn(),
      getAgentsByPlugin: vi.fn(),
      increaseInstallCount: vi.fn(),
    },
    plugins: {
      callCloudGateway: vi.fn(),
      createEvent: vi.fn(),
      getCategories: vi.fn(),
      getPluginDetail: vi.fn(),
      getPluginList: vi.fn(),
      getPluginManifest: vi.fn(),
      reportCall: vi.fn(),
      reportInstallation: vi.fn(),
    },
    registerClient: vi.fn(),
    user: { getUserInfo: vi.fn() },
  },
  marketServiceOptions: [] as unknown[],
}));

vi.mock('@/server/services/market', () => ({
  MarketService: class {
    market = market;
    fetchM2MToken = fetchM2MToken;
    constructor(options: unknown) {
      marketServiceOptions.push(options);
    }
  },
}));
vi.mock('@/server/modules/AssistantStore', () => ({
  AssistantStore: class {
    getAgent = getAgent;
  },
}));
vi.mock('@/server/modules/PluginStore', () => ({
  PluginStore: class {
    getPluginList = getPluginList;
  },
}));
vi.mock('@/locales/resources', () => ({ normalizeLocale: (locale?: string) => locale || 'en' }));
vi.mock('@lobechat/builtin-tools', () => ({ builtinTools: [] }));
vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadModels: vi.fn().mockResolvedValue([
    { displayName: 'GPT-4', id: 'gpt-4', providerId: 'openai' },
    { displayName: 'GPT-4', id: 'openrouter/gpt-4', providerId: 'openrouter' },
  ]),
}));
vi.mock('model-bank/modelProviders', () => ({
  DEFAULT_MODEL_PROVIDER_LIST: [
    { description: 'OpenAI provider', id: 'openai', name: 'OpenAI' },
    { description: 'OpenRouter provider', id: 'openrouter', name: 'OpenRouter' },
  ],
}));

const emptyPage = { currentPage: 1, items: [], pageSize: 7, totalCount: 0, totalPages: 0 };

describe('DiscoverService delegation and market proxies', () => {
  let service: DiscoverService;

  beforeEach(() => {
    vi.clearAllMocks();
    marketServiceOptions.length = 0;
    getPluginList.mockResolvedValue([]);
    market.agents.getAgentList.mockResolvedValue({ items: [] });
    market.plugins.getPluginList.mockResolvedValue({ items: [] });
    service = new DiscoverService();
  });

  describe('client registration', () => {
    it('registers a web client with the Vercel project id as device id', async () => {
      vi.stubEnv('VERCEL_PROJECT_ID', 'project-1');
      market.registerClient.mockResolvedValue({ client_id: 'id-1', client_secret: 'secret-1' });

      await expect(service.registerClient({ userAgent: 'test-agent' })).resolves.toEqual({
        clientId: 'id-1',
        clientSecret: 'secret-1',
      });
      expect(market.registerClient).toHaveBeenCalledWith(
        expect.objectContaining({
          clientName: 'LobeHub Web',
          clientType: 'web',
          deviceId: 'project-1',
          platform: 'test-agent',
        }),
      );
      vi.unstubAllEnvs();
    });

    it('fetches an M2M token through a MarketService built from client credentials', async () => {
      fetchM2MToken.mockResolvedValue({ accessToken: 'token-1', expiresIn: 60, other: true });

      await expect(
        service.fetchM2MToken({ clientId: 'id-1', clientSecret: 'secret-1' }),
      ).resolves.toEqual({ accessToken: 'token-1', expiresIn: 60 });
      expect(marketServiceOptions.at(-1)).toEqual({
        clientCredentials: { clientId: 'id-1', clientSecret: 'secret-1' },
      });
    });

    it.each([
      { expectedHeaders: { Authorization: 'Bearer user-token' }, userAccessToken: 'user-token' },
      { expectedHeaders: {}, userAccessToken: undefined },
    ])(
      'calls the cloud MCP gateway with headers $expectedHeaders',
      async ({ expectedHeaders, userAccessToken }) => {
        market.plugins.callCloudGateway.mockResolvedValue({ ok: true });

        await expect(
          service.callCloudMcpEndpoint({
            apiParams: { a: 1 },
            identifier: 'mcp-1',
            toolName: 'tool-1',
            userAccessToken,
          }),
        ).resolves.toEqual({ ok: true });
        expect(market.plugins.callCloudGateway).toHaveBeenCalledWith(
          { apiParams: { a: 1 }, identifier: 'mcp-1', toolName: 'tool-1' },
          { headers: expectedHeaders },
        );
      },
    );
  });

  describe('analytics', () => {
    it.each([
      ['reportPluginInstallation', market.plugins.reportInstallation, { identifier: 'p' }],
      ['createAgentEvent', market.agents.createEvent, { event: 'click', identifier: 'a' }],
      ['createPluginEvent', market.plugins.createEvent, { event: 'click', identifier: 'p' }],
      ['reportCall', market.plugins.reportCall, { identifier: 'p', success: true }],
      ['increaseAgentInstallCount', market.agents.increaseInstallCount, 'agent-1'],
    ] as const)('%s forwards its argument to the market SDK', async (method, sdk, arg) => {
      await (service as any)[method](arg);

      expect(sdk).toHaveBeenCalledWith(arg);
    });

    it('getAgentsByPlugin transforms market agents', async () => {
      market.agents.getAgentsByPlugin.mockResolvedValue({
        currentPage: 2,
        items: [{ author: { name: 'Author' }, identifier: 'agent-1', name: 'Agent 1', ownerId: 1 }],
        pageSize: 5,
        totalCount: 6,
        totalPages: 2,
      });

      const result = await service.getAgentsByPlugin({ page: 2, pageSize: 5, pluginId: 'p-1' });

      expect(market.agents.getAgentsByPlugin).toHaveBeenCalledWith({
        locale: 'en',
        page: 2,
        pageSize: 5,
        pluginId: 'p-1',
      });
      expect(result).toMatchObject({ currentPage: 2, totalCount: 6, totalPages: 2 });
      expect(result.items[0]).toMatchObject({
        author: 'Author',
        identifier: 'agent-1',
        title: 'Agent 1',
      });
    });

    it('getAgentsByPlugin returns an empty page when the SDK fails', async () => {
      market.agents.getAgentsByPlugin.mockRejectedValue(new Error('down'));

      await expect(service.getAgentsByPlugin({ pluginId: 'p-1' })).resolves.toEqual({
        currentPage: 1,
        items: [],
        pageSize: 20,
        totalCount: 0,
        totalPages: 0,
      });
    });
  });

  describe('group agents', () => {
    it('proxies categories, identifiers and list, with fallbacks on failure', async () => {
      market.agentGroups.getAgentGroupCategories.mockResolvedValue({ items: ['c'] });
      market.agentGroups.getAgentGroupIdentifiers.mockResolvedValue(undefined);
      market.agentGroups.getAgentGroupList.mockRejectedValue(new Error('down'));

      await expect(service.getGroupAgentCategories({ locale: 'en' })).resolves.toEqual({
        items: ['c'],
      });
      await expect(service.getGroupAgentIdentifiers()).resolves.toEqual({ identifiers: [] });
      await expect(service.getGroupAgentList({ q: 'x' })).resolves.toEqual({
        currentPage: 1,
        items: [],
        totalCount: 0,
        totalPages: 1,
      });
      expect(market.agentGroups.getAgentGroupList).toHaveBeenCalledWith({
        q: 'x',
        status: 'published',
        visibility: 'public',
      });
    });

    it('converts the detail version to a number', async () => {
      market.agentGroups.getAgentGroupDetail.mockResolvedValue({ identifier: 'g' });

      await expect(
        service.getGroupAgentDetail({ identifier: 'g', locale: 'en', version: '3' }),
      ).resolves.toEqual({ identifier: 'g' });
      expect(market.agentGroups.getAgentGroupDetail).toHaveBeenCalledWith('g', {
        locale: 'en',
        version: 3,
      });
    });

    it('swallows event and install-count failures', async () => {
      market.agentGroups.createAgentGroupEvent.mockRejectedValue(new Error('down'));
      market.agentGroups.increaseInstallCount.mockRejectedValue(new Error('down'));

      await expect(
        service.createGroupAgentEvent({ event: 'click', identifier: 'g' }),
      ).resolves.toBeUndefined();
      await expect(service.increaseGroupAgentInstallCount('g')).resolves.toBeUndefined();
      expect(market.agentGroups.increaseInstallCount).toHaveBeenCalledWith('g');
    });
  });

  describe('assistant list sort mapping', () => {
    it.each([
      [AssistantSorts.UpdatedAt, 'updatedAt', undefined],
      [AssistantSorts.MostUsage, 'mostUsage', undefined],
      [AssistantSorts.HaveSkills, 'updatedAt', true],
      [AssistantSorts.Recommended, 'recommended', undefined],
    ])('sort %s maps to api sort %s', async (sort, apiSort, haveSkills) => {
      await service.getAssistantList({ category: AssistantCategory.All, sort });

      expect(market.agents.getAgentList).toHaveBeenCalledWith(
        expect.objectContaining({ category: undefined, haveSkills, sort: apiSort }),
      );
    });

    it('omits the all/discover MCP category and forces the recommended sort', async () => {
      await service.getMcpList({ category: McpCategory.Discover, sort: McpSorts.InstallCount });

      expect(market.plugins.getPluginList).toHaveBeenCalledWith(
        expect.objectContaining({ category: undefined, sort: McpSorts.Recommended }),
        expect.anything(),
      );
    });
  });

  describe('dispatch through the instance', () => {
    it('getAssistantDetail loads related items through service.getAssistantList', async () => {
      market.agents.getAgentDetail.mockResolvedValue({ category: 'c', identifier: 'a' });
      const spy = vi.spyOn(service, 'getAssistantList').mockResolvedValue({
        ...emptyPage,
        items: [{ identifier: 'a' }, { identifier: 'b' }] as any,
      });

      const result = await service.getAssistantDetail({ identifier: 'a', locale: 'de' });

      expect(spy).toHaveBeenCalledWith({
        category: 'c',
        includeAgentGroup: true,
        locale: 'de',
        page: 1,
        pageSize: 7,
        source: undefined,
      });
      expect(result?.related).toEqual([{ identifier: 'b' }]);
    });

    it('legacy getAssistantDetail loads related items through service.getAssistantList', async () => {
      getAgent.mockResolvedValue({ category: 'c', identifier: 'a', meta: { title: 'A' } });
      const spy = vi.spyOn(service, 'getAssistantList').mockResolvedValue(emptyPage);

      await expect(
        service.getAssistantDetail({ identifier: 'a', source: 'legacy' }),
      ).resolves.toMatchObject({ identifier: 'a', related: [], title: 'A' });
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ source: 'legacy' }));
    });

    it('getMcpDetail loads related items through service.getMcpList', async () => {
      market.plugins.getPluginDetail.mockResolvedValue({ category: 'c', identifier: 'm' });
      const spy = vi.spyOn(service, 'getMcpList').mockResolvedValue(emptyPage as any);

      await expect(service.getMcpDetail({ identifier: 'm' })).resolves.toMatchObject({
        identifier: 'm',
        related: [],
      });
      expect(spy).toHaveBeenCalledWith({ category: 'c', locale: undefined, page: 1, pageSize: 7 });
    });

    it('getPluginDetail converts a market MCP fetched through service.getMcpDetail', async () => {
      const spy = vi.spyOn(service, 'getMcpDetail').mockResolvedValue({
        author: { name: 'Author' },
        description: 'desc',
        identifier: 'm',
        name: 'MCP',
        related: [{ author: 'R', identifier: 'r', name: 'Related' }],
      } as any);

      const result = await service.getPluginDetail({ identifier: 'm', locale: 'de' });

      expect(spy).toHaveBeenCalledWith({ identifier: 'm', locale: 'de' });
      expect(result).toMatchObject({
        author: 'Author',
        identifier: 'm',
        related: [{ author: 'R', identifier: 'r', title: 'Related' }],
        source: 'market',
        title: 'MCP',
      });
    });

    it('legacy getPluginDetail loads related items through service.getPluginList', async () => {
      getPluginList.mockResolvedValue([{ category: 'c', identifier: 'p', meta: {} }]);
      const spy = vi.spyOn(service, 'getPluginList').mockResolvedValue(emptyPage as any);

      await service.getPluginDetail({ identifier: 'p' });

      expect(spy).toHaveBeenCalledWith({ category: 'c', locale: undefined, page: 1, pageSize: 7 });
    });

    it('getProviderDetail loads related items through service.getProviderList', async () => {
      const spy = vi.spyOn(service, 'getProviderList').mockResolvedValue(emptyPage as any);

      await expect(service.getProviderDetail({ identifier: 'openai' })).resolves.toMatchObject({
        identifier: 'openai',
        models: [{ id: 'gpt-4' }],
      });
      expect(spy).toHaveBeenCalledWith({ page: 1, pageSize: 7 });
    });

    it('getModelDetail loads related items through service.getModelList', async () => {
      const spy = vi.spyOn(service, 'getModelList').mockResolvedValue(emptyPage as any);

      const result = await service.getModelDetail({ identifier: 'gpt-4' });

      expect(spy).toHaveBeenCalledWith({ page: 1, pageSize: 7, q: 'gpt' });
      expect(result?.providers.map((p) => p.id)).toEqual(['openai', 'openrouter']);
    });
  });

  describe('catalog identifiers and categories', () => {
    it('lists plugin categories and identifiers from the legacy plugin store', async () => {
      getPluginList.mockResolvedValue([
        { category: 'tools', createdAt: '2024-01-01', identifier: 'p1', meta: {} },
        { category: 'tools', createdAt: '2024-01-02', identifier: 'p2', meta: {} },
      ]);

      await expect(service.getPluginCategories()).resolves.toEqual([
        { category: 'tools', count: 2 },
      ]);
      await expect(service.getPluginIdentifiers()).resolves.toEqual([
        { identifier: 'p1', lastModified: '2024-01-01' },
        { identifier: 'p2', lastModified: '2024-01-02' },
      ]);
      await expect(service.getLegacyPluginList({ locale: 'de' })).resolves.toHaveLength(2);
      expect(getPluginList).toHaveBeenLastCalledWith('de');
    });

    it('lists provider and model identifiers', async () => {
      const providers = await service.getProviderIdentifiers();
      const models = await service.getModelIdentifiers();

      expect(providers.map((p) => p.identifier)).toEqual(['openai', 'openrouter']);
      expect(models.map((m) => m.identifier)).toEqual(['gpt-4']);
    });

    it('proxies MCP categories and manifests with a normalized locale', async () => {
      market.plugins.getCategories.mockResolvedValue([{ category: 'c', count: 1 }]);
      market.plugins.getPluginManifest.mockResolvedValue({ name: 'manifest' });

      await expect(service.getMcpCategories({ q: 'x' })).resolves.toEqual([
        { category: 'c', count: 1 },
      ]);
      await expect(service.getMcpManifest({ identifier: 'm' })).resolves.toEqual({
        name: 'manifest',
      });
      expect(market.plugins.getCategories).toHaveBeenCalledWith(
        { locale: 'en', q: 'x' },
        { next: { revalidate: 3600 } },
      );
      expect(market.plugins.getPluginManifest).toHaveBeenCalledWith(
        { identifier: 'm', locale: 'en' },
        expect.anything(),
      );
    });

    it('falls back to a Composio tool when no other source has the plugin', async () => {
      const composio = COMPOSIO_APP_TYPES[0];
      market.plugins.getPluginDetail.mockRejectedValue(new MarketAPIError(404, 'Not Found'));

      await expect(
        service.getPluginDetail({ identifier: composio.identifier }),
      ).resolves.toMatchObject({
        author: 'Composio',
        identifier: composio.identifier,
        source: 'builtin',
        title: composio.label,
      });
    });
  });

  describe('user profile', () => {
    it('transforms every collection of the market user profile', async () => {
      market.user.getUserInfo.mockResolvedValue({
        agentGroups: [{ identifier: 'g1', name: 'Group 1' }],
        agents: [{ identifier: 'a1', name: 'Agent 1' }],
        favoriteAgentGroups: [{ author: 'Fav', identifier: 'fg1' }],
        favoriteAgents: [{ author: 'Fav', identifier: 'fa1' }],
        forkedAgentGroups: [{ identifier: 'kg1' }],
        forkedAgents: [{ identifier: 'ka1' }],
        plugins: [{ identifier: 'p1', name: 'Plugin 1' }],
        skills: [{ identifier: 's1' }],
        user: {
          createdAt: '2024-01-01',
          displayName: 'Display',
          followerCount: 3,
          id: 1,
          meta: { bannerUrl: 'banner' },
          namespace: 'ns',
          userName: 'user',
        },
      });

      const result = await service.getUserInfo({ locale: 'en', username: 'user' });

      expect(market.user.getUserInfo).toHaveBeenCalledWith('user', { locale: 'en' });
      expect(result).toMatchObject({
        agentGroups: [{ author: 'Display', avatar: '👥', identifier: 'g1', title: 'Group 1' }],
        agents: [{ author: 'Display', identifier: 'a1', title: 'Agent 1' }],
        favoriteAgentGroups: [{ author: 'Fav', forkedFromGroupId: null, identifier: 'fg1' }],
        favoriteAgents: [{ author: 'Fav', forkedFromAgentId: null, identifier: 'fa1' }],
        forkedAgentGroups: [{ author: 'Display', forkCount: 0, identifier: 'kg1' }],
        forkedAgents: [{ author: 'Display', forkCount: 0, identifier: 'ka1' }],
        plugins: [{ identifier: 'p1', manifest: '', title: 'Plugin 1' }],
        skills: [{ identifier: 's1', name: 's1', version: 'latest' }],
        user: {
          avatarUrl: null,
          bannerUrl: 'banner',
          followersCount: 3,
          followingCount: 0,
          id: 1,
          userName: 'user',
        },
      });
    });

    it('returns undefined when the market has no user', async () => {
      market.user.getUserInfo.mockResolvedValue({});

      await expect(service.getUserInfo({ username: 'missing' })).resolves.toBeUndefined();
    });
  });
});
