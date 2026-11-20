// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { UserModel } from '@/database/models/user';
import { GoalSearchRepo } from '@/database/repositories/goalSearch';
import { TaskSearchRepo } from '@/database/repositories/taskSearch';
import { DiscoverService } from '@/server/services/discover';
import { createFtsSearchRepo } from '@/server/services/ftsSearch';

import { searchRouter } from '../search';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/server/services/ftsSearch', () => ({ createFtsSearchRepo: vi.fn() }));

vi.mock('@/database/models/user', () => ({
  UserModel: Object.assign(vi.fn(), { findById: vi.fn() }),
}));

vi.mock('@/database/repositories/taskSearch', () => ({ TaskSearchRepo: vi.fn() }));

vi.mock('@/database/repositories/goalSearch', () => ({ GoalSearchRepo: vi.fn() }));

vi.mock('@/database/models/message', () => ({
  MESSAGE_KEYWORD_SEARCH_MAX_LIMIT: 100,
  MessageModel: vi.fn(),
}));

vi.mock('@/server/services/discover', () => ({
  DiscoverService: vi.fn(),
}));

describe('searchRouter', () => {
  const getAssistantList = vi.fn();
  const getMcpList = vi.fn();
  const getPluginList = vi.fn();
  const getUserSettings = vi.fn();
  const search = vi.fn();
  const searchTasks = vi.fn();
  const searchGoals = vi.fn();
  const searchByKeyword = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getAssistantList.mockReset();
    getMcpList.mockResolvedValue({ items: [] });
    getPluginList.mockResolvedValue({ items: [] });
    getUserSettings.mockResolvedValue({ market: { accessToken: 'market-token' } });
    search.mockResolvedValue([]);
    searchTasks.mockResolvedValue([]);
    searchGoals.mockResolvedValue([]);
    searchByKeyword.mockResolvedValue({ hasMore: false, items: [] });
    vi.mocked(GoalSearchRepo).mockImplementation(function () {
      return { search: searchGoals } as unknown as GoalSearchRepo;
    });
    vi.mocked(MessageModel).mockImplementation(function () {
      return { searchByKeyword } as unknown as MessageModel;
    });
    vi.mocked(TaskSearchRepo).mockImplementation(function () {
      return { search: searchTasks } as unknown as TaskSearchRepo;
    });
    vi.mocked(UserModel.findById).mockResolvedValue({
      email: 'user@example.com',
      fullName: 'Test User',
    } as any);
    vi.mocked(UserModel).mockImplementation(function () {
      return { getUserSettings } as any;
    });
    vi.mocked(createFtsSearchRepo).mockResolvedValue({ search } as any);
    vi.mocked(DiscoverService).mockImplementation(function () {
      return { getAssistantList, getMcpList, getPluginList } as unknown as DiscoverService;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty community agent result when the market search succeeds with no matches', async () => {
    getAssistantList.mockResolvedValue({
      currentPage: 1,
      items: [],
      pageSize: 5,
      totalCount: 0,
      totalPages: 0,
    });
    const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

    const result = await caller.query({ query: 'missing', type: 'communityAgent' });

    expect(result).toEqual([]);
    expect(DiscoverService).toHaveBeenCalledWith({
      accessToken: 'market-token',
      userInfo: {
        email: 'user@example.com',
        name: 'Test User',
        userId: 'test-user',
      },
    });
    expect(getAssistantList).toHaveBeenCalledWith(
      {
        includeAgentGroup: true,
        locale: undefined,
        pageSize: 5,
        q: 'missing',
      },
      { throwOnError: true },
    );
    expect(createFtsSearchRepo).not.toHaveBeenCalled();
  });

  it('does not load market identity for a local-only search', async () => {
    const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

    const result = await caller.query({ query: 'local message', type: 'message' });

    expect(result).toEqual([]);
    expect(search).toHaveBeenCalledWith({
      excludeKnowledgeBaseIds: [],
      query: 'local message',
      type: 'message',
    });
    expect(createFtsSearchRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: 'unified_search',
        userId: 'test-user',
        workspaceId: undefined,
      }),
    );
    expect(UserModel.findById).not.toHaveBeenCalled();
    expect(getUserSettings).not.toHaveBeenCalled();
    expect(searchTasks).not.toHaveBeenCalled();
  });

  it('looks up only tasks for a task-typed search', async () => {
    const taskResult = { id: 'task_1', identifier: 'T-827', title: 'CMDK', type: 'task' };
    searchTasks.mockResolvedValue([taskResult]);
    const caller = searchRouter.createCaller({
      userId: 'test-user',
      workspaceId: 'ws_1',
    } as any);

    const result = await caller.query({ limitPerType: 50, query: 'T-827', type: 'task' });

    expect(result).toEqual([taskResult]);
    // Scoped to the caller and active workspace, like TaskModel reads.
    expect(vi.mocked(TaskSearchRepo).mock.calls[0].slice(1)).toEqual(['test-user', 'ws_1']);
    expect(searchTasks).toHaveBeenCalledWith({ limit: 50, query: 'T-827' });
    expect(createFtsSearchRepo).not.toHaveBeenCalled();
    expect(getAssistantList).not.toHaveBeenCalled();
  });

  it('merges task matches into the untyped command-menu search', async () => {
    const localResult = { id: 'local-agent', title: 'Local Agent', type: 'agent' };
    const taskResult = { id: 'task_1', identifier: 'T-827', title: 'CMDK', type: 'task' };
    search.mockResolvedValue([localResult]);
    searchTasks.mockResolvedValue([taskResult]);
    const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

    const result = await caller.query({ includeMarketplace: false, query: 'T-827' });

    expect(result).toEqual([localResult, taskResult]);
    expect(searchTasks).toHaveBeenCalledWith({ limit: 5, query: 'T-827' });
  });

  it('keeps untyped searches including the marketplace by default', async () => {
    const localResult = { id: 'local-agent', title: 'Local Agent', type: 'agent' };
    search.mockResolvedValue([localResult]);
    getAssistantList.mockResolvedValue({ items: [] });
    const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

    const result = await caller.query({ query: 'assistant' });

    expect(result).toEqual([localResult]);
    expect(getAssistantList).toHaveBeenCalled();
    expect(getMcpList).toHaveBeenCalled();
    expect(getPluginList).toHaveBeenCalled();
  });

  it('preserves untyped search results when the community agent search rejects', async () => {
    const localResult = { id: 'local-agent', title: 'Local Agent', type: 'agent' };
    search.mockResolvedValue([localResult]);
    getAssistantList.mockRejectedValue(new Error('Market unavailable'));
    const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

    const result = await caller.query({ query: 'assistant' });

    expect(result).toEqual([localResult]);
    expect(getAssistantList).toHaveBeenCalledWith(
      {
        includeAgentGroup: true,
        locale: undefined,
        pageSize: 5,
        q: 'assistant',
      },
      { throwOnError: false },
    );
  });

  it('keeps the opted-out aggregate search DB-only: no marketplace calls, no market identity', async () => {
    const localResult = { id: 'local-agent', title: 'Local Agent', type: 'agent' };
    search.mockResolvedValue([localResult]);
    const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

    const result = await caller.query({ includeMarketplace: false, query: 'assistant' });

    expect(result).toEqual([localResult]);
    expect(getAssistantList).not.toHaveBeenCalled();
    expect(getMcpList).not.toHaveBeenCalled();
    expect(getPluginList).not.toHaveBeenCalled();
    expect(UserModel.findById).not.toHaveBeenCalled();
    expect(getUserSettings).not.toHaveBeenCalled();
  });

  it.each(['mcp', 'communityAgent'] as const)(
    'caps the %s Market API page size at its maximum',
    async (type) => {
      getAssistantList.mockResolvedValue({ items: [] });
      const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

      // The command menu requests 50 per type in its typed view.
      await caller.query({ limitPerType: 50, query: 'github', type });

      const listFn = type === 'mcp' ? getMcpList : getAssistantList;
      expect(listFn).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 40 }),
        ...(type === 'communityAgent' ? [expect.anything()] : []),
      );
    },
  );

  it('keeps the requested limit for the locally paged legacy plugin catalog', async () => {
    const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

    await caller.query({ limitPerType: 50, query: 'github', type: 'plugin' });

    expect(getPluginList).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 50 }));
  });

  it('returns a typed error when the community agent market search fails', async () => {
    const marketError = new Error('Market unavailable');
    getAssistantList.mockRejectedValue(marketError);
    vi.spyOn(console, 'error').mockImplementation(function () {});
    const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

    await expect(
      caller.query({ query: 'assistant', type: 'communityAgent' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Marketplace agent search is currently unavailable',
    });
  });
  describe('goals', () => {
    const goal = { id: 'goal_1', status: 'paused', title: 'Replica (STAMP)', type: 'goal' };

    it('searches goals for an explicit goal type without touching the index', async () => {
      searchGoals.mockResolvedValue([goal]);
      const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

      const result = await caller.query({ limitPerType: 7, query: 'STAMP', type: 'goal' });

      expect(result).toEqual([goal]);
      expect(searchGoals).toHaveBeenCalledWith({ limit: 7, query: 'STAMP' });
      expect(search).not.toHaveBeenCalled();
      expect(getAssistantList).not.toHaveBeenCalled();
    });

    it('keeps goals out of untyped searches unless the caller opts in', async () => {
      searchGoals.mockResolvedValue([goal]);
      const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

      await caller.query({ includeMarketplace: false, query: 'STAMP' });
      expect(searchGoals).not.toHaveBeenCalled();

      const result = await caller.query({
        includeGoals: true,
        includeMarketplace: false,
        query: 'STAMP',
      });
      expect(result).toEqual([goal]);
    });
  });

  describe('recall', () => {
    it('combines message, topic, goal and page hits in the window without the marketplace', async () => {
      const startDate = new Date('2026-10-12T00:00:00.000Z');
      const endDate = new Date('2026-10-18T23:59:59.000Z');
      searchByKeyword.mockResolvedValue({
        hasMore: false,
        items: [
          {
            createdAt: new Date('2026-10-15T00:00:00.000Z'),
            id: 'msg_1',
            role: 'user',
            snippet: 'STAMP mode',
            topicId: 'tpc_1',
            topicTitle: 'Weekly',
          },
        ],
      });
      search.mockImplementation(async ({ type }: { type: string }) =>
        type === 'page'
          ? [
              {
                id: 'docs_in',
                title: 'STAMP notes',
                type: 'page',
                updatedAt: new Date('2026-10-16T00:00:00.000Z'),
              },
            ]
          : [],
      );
      searchGoals.mockResolvedValue([{ id: 'goal_1', title: 'Replica (STAMP)', type: 'goal' }]);
      const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

      const result = await caller.recall({ endDate, exact: true, query: 'STAMP', startDate });

      expect(searchByKeyword).toHaveBeenCalledWith(
        expect.objectContaining({ endDate, exact: true, keyword: 'STAMP', startDate }),
      );
      expect(searchGoals).toHaveBeenCalledWith({ endDate, limit: 10, query: 'STAMP', startDate });
      expect(result.messages.items.map(({ id }) => id)).toEqual(['msg_1']);
      expect(result.topics).toMatchObject([{ hitCount: 1, id: 'tpc_1', title: 'Weekly' }]);
      expect(result.goals.map(({ id }) => id)).toEqual(['goal_1']);
      expect(result.pages.map(({ id }) => id)).toEqual(['docs_in']);
      // The window reaches the repository, which applies it during retrieval.
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeKnowledgeBaseIds: expect.any(Array),
          timeRange: { end: endDate, field: 'updatedAt', start: startDate },
          type: 'page',
        }),
      );
      expect(DiscoverService).not.toHaveBeenCalled();
      expect(UserModel.findById).not.toHaveBeenCalled();
    });

    it('runs a goal-only recall without initializing full-text search', async () => {
      vi.mocked(createFtsSearchRepo).mockRejectedValue(new Error('provider unavailable'));
      searchGoals.mockResolvedValue([{ id: 'goal_1', title: 'Replica', type: 'goal' }]);
      const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

      const result = await caller.recall({ query: 'replica', types: ['goal'] });

      expect(result.goals.map(({ id }) => id)).toEqual(['goal_1']);
      expect(createFtsSearchRepo).not.toHaveBeenCalled();
      expect(MessageModel).not.toHaveBeenCalled();
    });
  });
});
