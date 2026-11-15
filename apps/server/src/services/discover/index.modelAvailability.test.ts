// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoverService } from './index';

const { business, market } = vi.hoisted(() => ({
  business: { enabled: true },
  market: {
    agentGroups: { getAgentGroupDetail: vi.fn() },
    agents: { getAgentDetail: vi.fn(), getAgentList: vi.fn() },
  },
}));

vi.mock('@/server/services/market', () => ({
  MarketService: class {
    market = market;
  },
}));
vi.mock('@/server/modules/AssistantStore', () => ({ AssistantStore: class {} }));
vi.mock('@/server/modules/PluginStore', () => ({ PluginStore: class {} }));
vi.mock('@/locales/resources', () => ({ normalizeLocale: (locale?: string) => locale || 'en' }));
vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get ENABLE_BUSINESS_FEATURES() {
    return business.enabled;
  },
}));
// The official model catalog: one live chat model plus one beta model granted to a single user.
vi.mock('@lobechat/business-model-bank/model-config', () => ({
  isLobeHubModelAvailable: async (
    id: string,
    type: string,
    options?: { userEmail?: string | null },
  ) =>
    type === 'chat' &&
    (id === 'live-model' || (id === 'beta-model' && options?.userEmail === 'tester@example.com')),
}));

const agentDetail = (config: Record<string, unknown>) => ({
  config,
  identifier: 'market-agent',
  name: 'Market agent',
  summary: '',
});

const groupDetail = (memberConfig: Record<string, unknown>) => ({
  group: { identifier: 'market-group', name: 'Market group' },
  memberAgents: [
    {
      agent: { identifier: 'member', name: 'Member', role: 'supervisor' },
      currentVersion: { config: memberConfig, name: 'Member' },
    },
    { config: memberConfig, identifier: 'flat-member', name: 'Flat member', role: 'participant' },
  ],
});

describe('DiscoverService Market model availability', () => {
  let service: DiscoverService;

  beforeEach(() => {
    vi.resetAllMocks();
    business.enabled = true;
    market.agents.getAgentList.mockResolvedValue({ items: [] });
    service = new DiscoverService({ userInfo: { email: 'member@example.com', userId: 'u1' } });
  });

  const detailConfig = async (config: Record<string, unknown>) => {
    market.agents.getAgentDetail.mockResolvedValue(agentDetail(config));
    return (await service.getAssistantDetail({ identifier: 'market-agent' }))?.config;
  };

  it('drops an official model that is no longer served and keeps its parameters', async () => {
    const config = await detailConfig({
      model: {
        model: 'retired-model',
        parameters: { temperature: 1, top_p: 1 },
        provider: 'lobehub',
      },
      params: { temperature: 0.3 },
      systemRole: 'You parse documents.',
    });

    expect(config).not.toHaveProperty('model');
    expect(config).not.toHaveProperty('provider');
    expect(config).toMatchObject({
      params: { temperature: 0.3, top_p: 1 },
      systemRole: 'You parse documents.',
    });
  });

  it('drops a retired string model whose provider defaults to the official provider', async () => {
    const config = await detailConfig({ model: 'retired-model' });

    expect(config).not.toHaveProperty('model');
  });

  it('keeps an official model that is still served', async () => {
    const model = { model: 'live-model', parameters: { temperature: 1 }, provider: 'lobehub' };

    await expect(detailConfig({ model })).resolves.toEqual({ model });
  });

  it('judges beta models for the reading user', async () => {
    const config = { model: { model: 'beta-model', provider: 'lobehub' } };

    await expect(detailConfig(config)).resolves.not.toHaveProperty('model');

    service = new DiscoverService({ userInfo: { email: 'tester@example.com', userId: 'u2' } });
    await expect(detailConfig(config)).resolves.toEqual(config);
  });

  it('leaves models of other providers alone', async () => {
    const config = { model: 'retired-model', provider: 'openai' };

    await expect(detailConfig(config)).resolves.toEqual(config);
  });

  it('changes nothing without business features', async () => {
    business.enabled = false;
    const config = { model: { model: 'retired-model', provider: 'lobehub' } };

    await expect(detailConfig(config)).resolves.toEqual(config);
  });

  it('drops a retired model from group members', async () => {
    market.agentGroups.getAgentGroupDetail.mockResolvedValue(
      groupDetail({
        model: { model: 'retired-model', parameters: { temperature: 1 }, provider: 'lobehub' },
        systemRole: 'Lead the group.',
      }),
    );

    const detail = await service.getGroupAgentDetail({ identifier: 'market-group' });
    const [versioned, flat] = detail.memberAgents as any[];

    for (const memberConfig of [versioned.currentVersion.config, flat.config]) {
      expect(memberConfig).not.toHaveProperty('model');
      expect(memberConfig).toMatchObject({
        params: { temperature: 1 },
        systemRole: 'Lead the group.',
      });
    }
  });
});
