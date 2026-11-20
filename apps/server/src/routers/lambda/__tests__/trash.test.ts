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
const mockFindByIds = vi.fn(async () => [{ deletedByUserId: 'member-1', id: 'trash-1' }]);
const mockFindPrivateIds = vi.fn(async () => new Set<string>());
const mockRestore = vi.fn(async () => ({ failed: [], restored: [] }));
const mockPurge = vi.fn(async () => ({ purged: 1 }));
vi.mock('@/server/services/trash', () => ({
  TrashService: vi.fn(function () {
    return {
      countByType: mockCountByType,
      emptyTrash: mockEmptyTrash,
      findByIds: mockFindByIds,
      findPrivateIds: mockFindPrivateIds,
      list: mockList,
      purge: mockPurge,
      restore: mockRestore,
    };
  }),
}));

const { trashRouter } = await import('../trash');

const owner: any = { serverDB: {}, userId: 'owner-1', workspaceId: 'ws-1', workspaceRole: 'owner' };
const admin: any = { ...owner, userId: 'admin-1', workspaceRole: 'admin' };
const member: any = { ...owner, userId: 'member-1', workspaceRole: 'member' };
const personal: any = { serverDB: {}, userId: 'user-1' };

describe('trashRouter visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows every role the public side and pins the private side to the caller', async () => {
    for (const ctx of [owner, admin, member]) {
      const caller = trashRouter.createCaller(ctx);
      await caller.list({ resourceType: 'message', visibility: 'public' });
      await caller.countByType({ visibility: 'public' });
      expect(mockList).toHaveBeenLastCalledWith({
        resourceType: 'message',
        visibility: 'public',
      });
      expect(mockCountByType).toHaveBeenLastCalledWith({ visibility: 'public' });

      await caller.list({ visibility: 'private' });
      await caller.countByType({ visibility: 'private' });
      await caller.emptyTrash({ visibility: 'private', workspaceId: 'ws-1' });
      expect(mockList).toHaveBeenLastCalledWith(
        expect.objectContaining({ deletedByUserId: ctx.userId, visibility: 'private' }),
      );
      expect(mockCountByType).toHaveBeenLastCalledWith({
        deletedByUserId: ctx.userId,
        visibility: 'private',
      });
      expect(mockEmptyTrash).toHaveBeenLastCalledWith(
        expect.objectContaining({ deletedByUserId: ctx.userId, visibility: 'private' }),
      );
    }
  });

  it('keeps a workspace request without a side to the caller’s own deletions', async () => {
    await trashRouter.createCaller(owner).list();
    expect(mockList).toHaveBeenLastCalledWith({ deletedByUserId: 'owner-1' });
  });

  it('keeps a personal bin unfiltered, whatever side is asked for', async () => {
    const caller = trashRouter.createCaller(personal);
    await caller.list({ visibility: 'public' });
    await caller.countByType({ visibility: 'private' });

    expect(mockList).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ deletedByUserId: expect.anything() }),
    );
    expect(mockCountByType).toHaveBeenLastCalledWith({ projectId: undefined });
  });

  it('lets only owners and admins empty the public side', async () => {
    await expect(
      trashRouter.createCaller(member).emptyTrash({ visibility: 'public', workspaceId: 'ws-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockEmptyTrash).not.toHaveBeenCalled();

    for (const ctx of [owner, admin]) {
      await trashRouter.createCaller(ctx).emptyTrash({ visibility: 'public', workspaceId: 'ws-1' });
      expect(mockEmptyTrash).toHaveBeenLastCalledWith({ visibility: 'public' });
    }
  });

  it('lets a manager restore or purge another member’s public deletion, never a private one', async () => {
    const asOwner = trashRouter.createCaller(owner);
    await asOwner.restore({ ids: ['trash-1'] });
    await asOwner.purge({ ids: ['trash-1'] });
    expect(mockRestore).toHaveBeenCalledWith(['trash-1']);
    expect(mockPurge).toHaveBeenCalledWith(['trash-1']);

    mockRestore.mockClear();
    mockPurge.mockClear();
    mockFindPrivateIds.mockResolvedValueOnce(new Set(['trash-1']));
    await expect(asOwner.restore({ ids: ['trash-1'] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    mockFindPrivateIds.mockResolvedValueOnce(new Set(['trash-1']));
    await expect(trashRouter.createCaller(admin).purge({ ids: ['trash-1'] })).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    expect(mockRestore).not.toHaveBeenCalled();
    expect(mockPurge).not.toHaveBeenCalled();
  });

  it('lets a member manage only their own deletions', async () => {
    const asMember = trashRouter.createCaller(member);
    await asMember.restore({ ids: ['trash-1'] });
    expect(mockRestore).toHaveBeenCalledWith(['trash-1']);

    mockFindByIds.mockResolvedValueOnce([{ deletedByUserId: 'owner-1', id: 'trash-2' }]);
    await expect(asMember.purge({ ids: ['trash-2'] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mockPurge).not.toHaveBeenCalled();
  });
});
