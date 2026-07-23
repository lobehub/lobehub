// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';
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
  const getUserSettings = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getAssistantList.mockReset();
    getUserSettings.mockResolvedValue({ market: { accessToken: 'market-token' } });
    vi.mocked(UserModel.findById).mockResolvedValue({
      email: 'user@example.com',
      fullName: 'Test User',
    } as any);
    vi.mocked(UserModel).mockImplementation(() => ({ getUserSettings }) as any);
    vi.mocked(DiscoverService).mockImplementation(
      () => ({ getAssistantList }) as unknown as DiscoverService,
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
