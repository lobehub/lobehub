// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';
import { SearchRepo } from '@/database/repositories/search';
import { DiscoverService } from '@/server/services/discover';

import { searchRouter } from '../search';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/database/repositories/search', () => ({
  SearchRepo: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: Object.assign(vi.fn(), { findById: vi.fn() }),
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

  beforeEach(() => {
    vi.clearAllMocks();
    getAssistantList.mockReset();
    getMcpList.mockResolvedValue({ items: [] });
    getPluginList.mockResolvedValue({ items: [] });
    getUserSettings.mockResolvedValue({ market: { accessToken: 'market-token' } });
    search.mockResolvedValue([]);
    vi.mocked(UserModel.findById).mockResolvedValue({
      email: 'user@example.com',
      fullName: 'Test User',
    } as any);
    vi.mocked(UserModel).mockImplementation(() => ({ getUserSettings }) as any);
    vi.mocked(SearchRepo).mockImplementation(() => ({ search }) as unknown as SearchRepo);
    vi.mocked(DiscoverService).mockImplementation(
      () => ({ getAssistantList, getMcpList, getPluginList }) as unknown as DiscoverService,
    );
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
  });

  it('does not load market identity for a local-only search', async () => {
    const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

    const result = await caller.query({ query: 'local message', type: 'message' });

    expect(result).toEqual([]);
    expect(search).toHaveBeenCalledWith({ query: 'local message', type: 'message' });
    expect(UserModel.findById).not.toHaveBeenCalled();
    expect(getUserSettings).not.toHaveBeenCalled();
  });

  it('preserves global search results when the community agent search rejects', async () => {
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

  it('returns a typed error when the community agent market search fails', async () => {
    const marketError = new Error('Market unavailable');
    getAssistantList.mockRejectedValue(marketError);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const caller = searchRouter.createCaller({ userId: 'test-user' } as any);

    await expect(
      caller.query({ query: 'assistant', type: 'communityAgent' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Marketplace agent search is currently unavailable',
    });
  });
});
