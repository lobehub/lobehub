// @vitest-environment node
import { MarketAPIError } from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoverService } from './index';

const { market, getPluginList } = vi.hoisted(() => ({
  getPluginList: vi.fn(),
  market: {
    agentGroups: { getAgentGroupDetail: vi.fn() },
    agents: { getAgentDetail: vi.fn(), getAgentList: vi.fn() },
    plugins: {
      getPluginDetail: vi.fn(),
      getPluginList: vi.fn(),
      getPluginManifest: vi.fn(),
    },
    user: { getUserInfo: vi.fn() },
  },
}));

vi.mock('@/server/services/market', () => ({
  MarketService: class {
    market = market;
  },
}));
vi.mock('@/server/modules/AssistantStore', () => ({ AssistantStore: class {} }));
vi.mock('@/server/modules/PluginStore', () => ({
  PluginStore: class {
    getPluginList = getPluginList;
  },
}));
vi.mock('@/locales/resources', () => ({ normalizeLocale: (locale?: string) => locale || 'en' }));
vi.mock('@lobechat/builtin-tools', () => ({
  builtinTools: [
    { identifier: 'builtin-test', manifest: { meta: { title: 'Builtin test tool' } } },
  ],
}));

const missingErrors = [
  new MarketAPIError(404, 'Not Found'),
  new MarketAPIError(400, 'Bad Request', { error: { code: 'NOT_FOUND', message: 'Missing' } }),
];
const otherErrors = [
  ...[401, 403, 429, 500, 503].map((status) => new MarketAPIError(status, `Market ${status}`)),
  new Error('Network unavailable'),
];

describe('DiscoverService Market detail failures', () => {
  let service: DiscoverService;

  beforeEach(() => {
    vi.resetAllMocks();
    getPluginList.mockResolvedValue([]);
    market.agents.getAgentList.mockResolvedValue({ items: [] });
    market.plugins.getPluginList.mockResolvedValue({ items: [] });
    service = new DiscoverService();
  });

  describe.each([
    {
      call: (s: DiscoverService) => s.getAssistantDetail({ identifier: 'test-agent' }),
      name: 'assistant',
      sdk: market.agents.getAgentDetail,
    },
    {
      call: (s: DiscoverService) => s.getUserInfo({ username: 'test-user' }),
      name: 'user',
      sdk: market.user.getUserInfo,
    },
    {
      call: (s: DiscoverService) => s.getPluginDetail({ identifier: 'missing-plugin' }),
      name: 'plugin',
      sdk: market.plugins.getPluginDetail,
    },
  ])('$name lookup', ({ call, sdk }) => {
    it.each(missingErrors)('returns undefined for a Market not-found error: %s', async (error) => {
      sdk.mockRejectedValue(error);

      await expect(call(service)).resolves.toBeUndefined();
    });

    it.each(otherErrors)('propagates the original failure: %s', async (error) => {
      sdk.mockRejectedValue(error);

      await expect(call(service)).rejects.toBe(error);
    });
  });

  describe.each([
    {
      call: (s: DiscoverService) => s.getGroupAgentDetail({ identifier: 'test-group' }),
      name: 'group',
      sdk: market.agentGroups.getAgentGroupDetail,
    },
    {
      call: (s: DiscoverService) => s.getMcpDetail({ identifier: 'test-mcp' }),
      name: 'MCP',
      sdk: market.plugins.getPluginDetail,
    },
    {
      call: (s: DiscoverService) => s.getMcpManifest({ identifier: 'test-mcp' }),
      name: 'MCP manifest',
      sdk: market.plugins.getPluginManifest,
    },
  ])('$name lookup', ({ call, sdk }) => {
    it.each([missingErrors[0], ...otherErrors])(
      'propagates the original failure: %s',
      async (error) => {
        sdk.mockRejectedValue(error);

        await expect(call(service)).rejects.toBe(error);
      },
    );
  });

  it('still returns an assistant detail after a successful SDK response', async () => {
    market.agents.getAgentDetail.mockResolvedValue({
      identifier: 'test-agent',
      name: 'Test agent',
    });

    await expect(service.getAssistantDetail({ identifier: 'test-agent' })).resolves.toMatchObject({
      identifier: 'test-agent',
      title: 'Test agent',
    });
  });

  it('still returns a user profile after a successful SDK response', async () => {
    market.user.getUserInfo.mockResolvedValue({ user: { id: 1, userName: 'test-user' } });

    await expect(service.getUserInfo({ username: 'test-user' })).resolves.toMatchObject({
      user: { id: 1, userName: 'test-user' },
    });
  });

  it('still returns legacy plugin detail with related items without querying Market', async () => {
    getPluginList.mockResolvedValue([
      { identifier: 'legacy-plugin', meta: { title: 'Legacy plugin' } },
    ]);

    await expect(service.getPluginDetail({ identifier: 'legacy-plugin' })).resolves.toMatchObject({
      identifier: 'legacy-plugin',
      related: [],
      source: 'legacy',
      title: 'Legacy plugin',
    });
    expect(market.plugins.getPluginDetail).not.toHaveBeenCalled();
  });

  it.each(missingErrors)(
    'still falls back to builtin tools for Market not-found: %s',
    async (error) => {
      market.plugins.getPluginDetail.mockRejectedValue(error);

      await expect(service.getPluginDetail({ identifier: 'builtin-test' })).resolves.toMatchObject({
        identifier: 'builtin-test',
        source: 'builtin',
      });
    },
  );
});
