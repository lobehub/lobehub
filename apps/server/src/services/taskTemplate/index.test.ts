// @vitest-environment node
import { TASK_TEMPLATE_RECOMMEND_MAX_COUNT } from '@lobechat/const';
import type { TaskTemplate } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskTemplateService } from './index';

const { mockGetTaskTemplateRecommendations, mockMarket } = vi.hoisted(() => {
  const market: {
    taskTemplates: {
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
  connectors: [],
  cronPattern: '0 9 * * *',
  description: 'Description',
  id: 101,
  identifier: 'daily-engineering',
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

  it('returns an empty list when Market returns no recommendation items', async () => {
    mockGetTaskTemplateRecommendations.mockResolvedValue({ items: [] });
    const service = new TaskTemplateService('user-1');

    const result = await service.listDailyRecommend(['coding']);

    expect(result).toEqual([]);
  });

  it('passes recommendation inputs to Market', async () => {
    const service = new TaskTemplateService('user-1');

    await service.listDailyRecommend(['coding'], {
      count: 10,
      enabledConnectors: [
        { identifier: 'github', source: 'lobehub' },
        { identifier: 'gmail', source: 'composio' },
      ],
      excludeIds: [101],
      locale: 'zh-CN',
      refreshSeed: 'refresh-1',
    });

    expect(mockGetTaskTemplateRecommendations).toHaveBeenCalledWith({
      count: 10,
      enabledConnectors: [
        { identifier: 'github', source: 'lobehub' },
        { identifier: 'gmail', source: 'composio' },
      ],
      excludeIds: [101],
      interestKeys: ['coding'],
      locale: 'zh-CN',
      refreshSeed: 'refresh-1',
    });
  });

  it('clamps oversized recommendation counts before calling Market', async () => {
    const service = new TaskTemplateService('user-1');

    await service.listDailyRecommend(['coding'], { count: 25 });

    expect(mockGetTaskTemplateRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ count: TASK_TEMPLATE_RECOMMEND_MAX_COUNT }),
    );
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

  it('returns official connector fields from Market recommendation items', async () => {
    const templateWithConnectors = {
      ...template,
      connectors: [
        { identifier: 'github', required: true, source: 'lobehub' },
        { identifier: 'gmail', required: false, source: 'composio' },
      ],
      id: 102,
    } satisfies TaskTemplate;
    mockGetTaskTemplateRecommendations.mockResolvedValue({ items: [templateWithConnectors] });
    const service = new TaskTemplateService('user-1');

    const result = await service.listDailyRecommend(['coding']);

    expect(result).toEqual([templateWithConnectors]);
  });

  it('drops malformed Market recommendation items', async () => {
    mockGetTaskTemplateRecommendations.mockResolvedValue({
      items: [
        template,
        { ...template, description: undefined },
        { ...template, connectors: [{ identifier: 'github', source: 'lobehub' }] },
      ],
    });
    const service = new TaskTemplateService('user-1');

    const result = await service.listDailyRecommend(['coding']);

    expect(result).toEqual([template]);
  });

  it('normalizes Market skill dependencies into task template connectors', async () => {
    const marketTemplate = {
      ...template,
      connectors: undefined,
      id: 102,
      optionalSkills: [{ skillProvider: 'gmail', skillSource: 'klavis' }],
      requiresSkills: [{ skillProvider: 'github', skillSource: 'lobehub' }],
    };
    mockGetTaskTemplateRecommendations.mockResolvedValue({ items: [marketTemplate] });
    const service = new TaskTemplateService('user-1');

    const result = await service.listDailyRecommend(['coding']);

    expect(result).toEqual([
      {
        ...template,
        connectors: [
          { identifier: 'github', required: true, source: 'lobehub' },
          { identifier: 'gmail', required: false, source: 'composio' },
        ],
        id: 102,
      },
    ]);
  });

  it('drops Market recommendation items with unknown connector identifiers', async () => {
    const validWithConnectors = {
      ...template,
      connectors: [
        { identifier: 'github', required: true, source: 'lobehub' },
        { identifier: 'gmail', required: false, source: 'composio' },
      ],
      id: 102,
    } satisfies TaskTemplate;
    mockGetTaskTemplateRecommendations.mockResolvedValue({
      items: [
        validWithConnectors,
        {
          ...template,
          connectors: [{ identifier: 'unknown-required', required: true, source: 'lobehub' }],
          id: 103,
        },
        {
          ...template,
          connectors: [{ identifier: 'unknown-optional', required: false, source: 'composio' }],
          id: 104,
        },
      ],
    });
    const service = new TaskTemplateService('user-1');

    const result = await service.listDailyRecommend(['coding']);

    expect(result).toEqual([validWithConnectors]);
  });
});
