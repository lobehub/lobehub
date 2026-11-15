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

describe('homeRouter.updatePinnedOrder', () => {
  let updatePinnedOrder: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    updatePinnedOrder = vi.fn();
    vi.mocked(HomeRepository).mockImplementation(function () {
      return { updatePinnedOrder } as never;
    });
  });

  it('refuses a workspace member reordering the team pins', async () => {
    matches.mockResolvedValue({ hasAllScope: false } as never);
    const caller = homeRouter.createCaller({ userId: 'member-1', workspaceId: 'ws-1' } as never);

    await expect(caller.updatePinnedOrder({ ids: ['a', 'b'] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(updatePinnedOrder).not.toHaveBeenCalled();
  });

  it('lets a workspace owner/admin save the team order', async () => {
    matches.mockResolvedValue({ hasAllScope: true } as never);
    const caller = homeRouter.createCaller({ userId: 'admin-1', workspaceId: 'ws-1' } as never);

    await caller.updatePinnedOrder({ ids: ['b', 'a'] });

    expect(updatePinnedOrder).toHaveBeenCalledWith(['b', 'a']);
  });

  it('saves the personal order without a workspace permission check', async () => {
    const caller = homeRouter.createCaller({ userId: 'user-1' } as never);

    await caller.updatePinnedOrder({ ids: ['a'] });

    expect(matches).not.toHaveBeenCalled();
    expect(updatePinnedOrder).toHaveBeenCalledWith(['a']);
  });

  it('accepts a pin list longer than the personal pin cap', async () => {
    // The `pinned` columns have no count limit, so a drag must be able to
    // submit every rendered row.
    const ids = Array.from({ length: 500 }, (_, index) => `agent-${index}`);
    const caller = homeRouter.createCaller({ userId: 'user-1' } as never);

    await caller.updatePinnedOrder({ ids });

    expect(updatePinnedOrder).toHaveBeenCalledWith(ids);
  });
});
