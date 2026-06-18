// @vitest-environment node
import type { TaskTemplate } from '@lobechat/const';
import { TASK_TEMPLATE_RECOMMEND_MAX_COUNT } from '@lobechat/const';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskTemplateRecommendationSeedKey, TaskTemplateService } from './index';

const { mockAppEnv, mockGetTaskTemplateRecommendations, mockMarket } = vi.hoisted(() => {
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
    mockAppEnv: {
      APP_URL: 'https://self-hosted.example',
      MARKET_TRUSTED_CLIENT_ID: 'client-id' as string | undefined,
      MARKET_TRUSTED_CLIENT_SECRET: 'secret' as string | undefined,
    },
    mockGetTaskTemplateRecommendations: vi.fn(),
    mockMarket: market,
  };
});

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(() => ({ market: mockMarket })),
}));

vi.mock('@/envs/app', () => ({
  appEnv: mockAppEnv,
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
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppEnv.MARKET_TRUSTED_CLIENT_ID = 'client-id';
    mockAppEnv.MARKET_TRUSTED_CLIENT_SECRET = 'secret';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockMarket.taskTemplates = {
      getTaskTemplateRecommendations: mockGetTaskTemplateRecommendations,
    };
    mockGetTaskTemplateRecommendations.mockResolvedValue({ items: [template] });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
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
      excludeIds: [101],
      locale: 'zh-CN',
      refreshSeed: 'refresh-1',
    });

    expect(mockGetTaskTemplateRecommendations).toHaveBeenCalledWith({
      count: 10,
      excludeIds: [101],
      interestKeys: ['coding'],
      locale: 'zh-CN',
      refreshSeed: 'refresh-1',
    });
  });

  it('does not pass seedKey when trusted client auth is enabled', async () => {
    const service = new TaskTemplateService('local-user-raw-id');

    await service.listDailyRecommend(['coding']);

    expect(mockGetTaskTemplateRecommendations.mock.calls[0][0]).not.toHaveProperty('seedKey');
  });

  it('uses an opaque stable seedKey without exposing the local user id when anonymous', async () => {
    mockAppEnv.MARKET_TRUSTED_CLIENT_ID = undefined;
    mockAppEnv.MARKET_TRUSTED_CLIENT_SECRET = undefined;
    const service = new TaskTemplateService('local-user-raw-id');

    await service.listDailyRecommend(['coding']);
    await service.listDailyRecommend(['coding']);

    const firstSeedKey = mockGetTaskTemplateRecommendations.mock.calls[0][0].seedKey;
    const secondSeedKey = mockGetTaskTemplateRecommendations.mock.calls[1][0].seedKey;
    expect(firstSeedKey).toBe(secondSeedKey);
    expect(firstSeedKey).not.toContain('local-user-raw-id');
    expect(firstSeedKey).toBe(createTaskTemplateRecommendationSeedKey('local-user-raw-id'));
  });

  it('clamps oversized recommendation counts before calling Market', async () => {
    const service = new TaskTemplateService('user-1');

    await service.listDailyRecommend(['coding'], { count: 25 });

    expect(mockGetTaskTemplateRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ count: TASK_TEMPLATE_RECOMMEND_MAX_COUNT }),
    );
  });

  it('throws when Market recommendations fail', async () => {
    mockGetTaskTemplateRecommendations.mockRejectedValue(new Error('market down'));
    const service = new TaskTemplateService('user-1');

    await expect(service.listDailyRecommend(['coding'])).rejects.toThrow('market down');
  });

  it('throws when Market returns a malformed response', async () => {
    mockGetTaskTemplateRecommendations.mockResolvedValue({});
    const service = new TaskTemplateService('user-1');

    await expect(service.listDailyRecommend(['coding'])).rejects.toThrow(
      'Market recommendations returned no items array',
    );
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

  it('throws when Market recommendation items are malformed', async () => {
    mockGetTaskTemplateRecommendations.mockResolvedValue({
      items: [
        template,
        null,
        [],
        { ...template, category: 'unknown-category' },
        { ...template, connectors: 'invalid-connectors' },
        { ...template, description: undefined },
        { ...template, icon: 'unknown-icon' },
        { ...template, id: 101.5 },
        { ...template, id: '101' },
        { ...template, identifier: 101 },
        { ...template, instruction: 101 },
        { ...template, interests: 'coding' },
        { ...template, interests: ['unknown-interest'] },
        { ...template, title: 101 },
        { ...template, cronPattern: 0 },
        { ...template, cronPattern: '0 9 * *' },
        { ...template, cronPattern: '*/0 * * * *' },
        { ...template, cronPattern: '0 */0 * * *' },
        { ...template, cronPattern: '60 9 * * *' },
        { ...template, cronPattern: '0 24 * * *' },
        { ...template, cronPattern: '0 9 1 * *' },
        { ...template, cronPattern: '0 9 * 1 *' },
        { ...template, cronPattern: '0 9 * * 7' },
        { ...template, cronPattern: '0 9 * * 1,7' },
        { ...template, connectors: [{ identifier: 101, required: true, source: 'lobehub' }] },
        { ...template, connectors: [{ identifier: 'github', source: 'lobehub' }] },
        { ...template, connectors: [{ identifier: 'github', required: true, source: 'unknown' }] },
      ],
    });
    const service = new TaskTemplateService('user-1');

    await expect(service.listDailyRecommend(['coding'])).rejects.toThrow(
      'Market recommendations returned malformed items',
    );
  });

  it('accepts scheduler-supported cron patterns from Market recommendation items', async () => {
    const templates = [
      { ...template, cronPattern: '0 * * * *', id: 102 },
      { ...template, cronPattern: '30 */6 * * *', id: 103 },
      { ...template, cronPattern: '*/30 * * * *', id: 104 },
      { ...template, cronPattern: '0 9 * * 1,3', id: 105 },
      { ...template, cronPattern: '0 9 * * 0,1,2,3,4,5,6', id: 106 },
    ] satisfies TaskTemplate[];
    mockGetTaskTemplateRecommendations.mockResolvedValue({ items: templates });
    const service = new TaskTemplateService('user-1');

    const result = await service.listDailyRecommend(['coding']);

    expect(result).toEqual(templates);
  });

  it('keeps valid optional template icons from Market recommendation items', async () => {
    const templateWithIcon = { ...template, icon: 'github', id: 102 } satisfies TaskTemplate;
    mockGetTaskTemplateRecommendations.mockResolvedValue({ items: [templateWithIcon] });
    const service = new TaskTemplateService('user-1');

    const result = await service.listDailyRecommend(['coding']);

    expect(result).toEqual([templateWithIcon]);
  });

  it('throws when Market recommendation items omit connectors', async () => {
    const marketTemplate = { ...template, connectors: undefined, id: 102 };
    mockGetTaskTemplateRecommendations.mockResolvedValue({ items: [marketTemplate] });
    const service = new TaskTemplateService('user-1');

    await expect(service.listDailyRecommend(['coding'])).rejects.toThrow(
      'Market recommendations returned malformed items',
    );
  });

  it('throws when Market recommendation items include unknown connector identifiers', async () => {
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

    await expect(service.listDailyRecommend(['coding'])).rejects.toThrow(
      'Market recommendations returned malformed items',
    );
  });
});
