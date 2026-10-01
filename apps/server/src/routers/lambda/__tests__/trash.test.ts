// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); the service is mocked, so the
// handle it returns is never dereferenced.
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

const mockList = vi.fn(async () => ({ items: [], nextCursor: null }));
const mockCountByType = vi.fn(async () => ({}));
const mockEmptyTrash = vi.fn(async () => ({ purged: 0 }));
vi.mock('@/server/services/trash', () => ({
  TrashService: vi.fn(function () {
    return { countByType: mockCountByType, emptyTrash: mockEmptyTrash, list: mockList };
  }),
}));

const { trashRouter } = await import('../trash');

const owner: any = { serverDB: {}, userId: 'owner-1', workspaceId: 'ws-1', workspaceRole: 'owner' };
const member: any = { ...owner, userId: 'member-1', workspaceRole: 'member' };
const personal: any = { serverDB: {}, userId: 'user-1' };

describe('trashRouter visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('limits a workspace non-owner to the roots they trashed themselves', async () => {
    const caller = trashRouter.createCaller(member);

    await caller.list({ resourceType: 'message' });
    await caller.countByType();

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ deletedByUserId: 'member-1', resourceType: 'message' }),
    );
    expect(mockCountByType).toHaveBeenCalledWith({ deletedByUserId: 'member-1' });
  });

  it('shows the owner and a personal user the whole bin in scope', async () => {
    for (const ctx of [owner, personal]) {
      const caller = trashRouter.createCaller(ctx);
      await caller.list();
      await caller.countByType();
    }

    for (const [params] of mockList.mock.calls as any[]) {
      expect(params.deletedByUserId).toBeUndefined();
    }
    for (const [options] of mockCountByType.mock.calls as any[]) {
      expect(options.deletedByUserId).toBeUndefined();
    }
  });
});
