// @vitest-environment node
import type { TaskTemplate } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskTemplateService } from './index';

const { mockGetTaskTemplateRecommendations, mockMarket } = vi.hoisted(() => {
  const market: {
    taskTemplates?: {
      getTaskTemplateRecommendations: ReturnType<typeof vi.fn>;
    };
  } = {
    taskTemplates: {
      getTaskTemplateRecommendations: vi.fn(),
    },
  };

  return {
    mockGetTaskTemplateRecommendations: vi.fn(),
    mockMarket: market,
  };
});

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(() => ({ market: mockMarket })),
}));

vi.mock('@/config/composio', () => ({
  composioEnv: { COMPOSIO_API_KEY: 'composio-key' },
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    MARKET_TRUSTED_CLIENT_ID: 'client-id',
    MARKET_TRUSTED_CLIENT_SECRET: 'secret',
  },
}));

const template = {
  category: 'engineering',
  cronPattern: '0 9 * * *',
  description: 'Description',
  id: 101,
  instruction: 'Instruction',
  interests: ['coding'],
  title: 'Title',
} satisfies TaskTemplate;

describe('TaskTemplateService.listDailyRecommend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarket.taskTemplates = {
      getTaskTemplateRecommendations: mockGetTaskTemplateRecommendations,
    };
    mockGetTaskTemplateRecommendations.mockResolvedValue({ items: [template] });
  });

  it('returns Market recommendation items', async () => {
    const service = new TaskTemplateService('user-1');

    const result = await service.listDailyRecommend(['coding']);

    expect(result).toEqual([template]);
  });

  it('passes recommendation inputs to Market', async () => {
    const service = new TaskTemplateService('user-1');

    await service.listDailyRecommend(['coding'], {
      count: 10,
      enabledSkillSources: new Set(['lobehub', 'composio']),
      excludeIds: [101],
      locale: 'zh-CN',
      refreshSeed: 'refresh-1',
    });

    expect(mockGetTaskTemplateRecommendations).toHaveBeenCalledWith({
      count: 10,
      enabledSkillSources: ['lobehub', 'composio'],
      excludeIds: [101],
      interestKeys: ['coding'],
      locale: 'zh-CN',
      refreshSeed: 'refresh-1',
    });
  });

  it('returns an empty list when the SDK has not exposed taskTemplates yet', async () => {
    mockMarket.taskTemplates = undefined;
    const service = new TaskTemplateService('user-1');

    const result = await service.listDailyRecommend(['coding']);

    expect(result).toEqual([]);
  });

  it('returns an empty list when Market recommendations fail', async () => {
    mockGetTaskTemplateRecommendations.mockRejectedValue(new Error('market down'));
    const service = new TaskTemplateService('user-1');

    const result = await service.listDailyRecommend(['coding']);

    expect(result).toEqual([]);
  });

  it('returns an empty list when Market returns malformed recommendations', async () => {
    mockGetTaskTemplateRecommendations.mockResolvedValue({});
    const service = new TaskTemplateService('user-1');

    const result = await service.listDailyRecommend(['coding']);

    expect(result).toEqual([]);
  });
});
