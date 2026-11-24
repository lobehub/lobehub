// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeRepository } from '@/database/repositories/home';
import { getWorkspaceScopedPermissionMatches } from '@/server/services/workspacePermission';

import { homeRouter } from '../home';

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/repositories/home', () => ({ HomeRepository: vi.fn() }));
vi.mock('@/server/services/home', () => ({ HomeService: vi.fn() }));
vi.mock('@/server/services/ftsSearch', () => ({ createFtsSearchRepo: vi.fn() }));
vi.mock('@/server/services/workspacePermission', () => ({
  getWorkspaceScopedPermissionMatches: vi.fn(),
  hasWorkspaceScopedPermission: vi.fn(),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => ({})) }));

const matches = vi.mocked(getWorkspaceScopedPermissionMatches);

describe('homeRouter.updateRecommendedAgents', () => {
  let updateRecommendedIds: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    updateRecommendedIds = vi.fn();
    vi.mocked(HomeRepository).mockImplementation(function () {
      return { updateRecommendedIds } as never;
    });
  });

  it('refuses a workspace member changing the recommended agents', async () => {
    matches.mockResolvedValue({ hasAllScope: false } as never);
    const caller = homeRouter.createCaller({ userId: 'member-1', workspaceId: 'ws-1' } as never);

    await expect(caller.updateRecommendedAgents({ ids: ['a'] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Only workspace owners and admins can change recommended agents',
    });
    expect(updateRecommendedIds).not.toHaveBeenCalled();
  });

  it('lets a workspace owner/admin save the list in order', async () => {
    matches.mockResolvedValue({ hasAllScope: true } as never);
    const caller = homeRouter.createCaller({ userId: 'admin-1', workspaceId: 'ws-1' } as never);

    await caller.updateRecommendedAgents({ ids: ['b', 'a'] });

    expect(updateRecommendedIds).toHaveBeenCalledWith(['b', 'a']);
  });

  it('rejects the call outside a workspace', async () => {
    const caller = homeRouter.createCaller({ userId: 'user-1' } as never);

    await expect(caller.updateRecommendedAgents({ ids: ['a'] })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(updateRecommendedIds).not.toHaveBeenCalled();
  });

  it('accepts a list as long as the team pins it starts from', async () => {
    // Until a list is saved the team pins are the list, so admins must be able
    // to save it back — trimmed or reordered — however many there are.
    matches.mockResolvedValue({ hasAllScope: true } as never);
    const ids = Array.from({ length: 500 }, (_, index) => `agent-${index}`);
    const caller = homeRouter.createCaller({ userId: 'admin-1', workspaceId: 'ws-1' } as never);

    await caller.updateRecommendedAgents({ ids });

    expect(updateRecommendedIds).toHaveBeenCalledWith(ids);
  });
});
