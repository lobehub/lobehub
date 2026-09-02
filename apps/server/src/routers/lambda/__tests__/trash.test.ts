// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrashService } from '@/server/services/trash';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';

import { trashRouter } from '../trash';

const mocks = vi.hoisted(() => ({
  service: {
    countByType: vi.fn(),
    emptyTrash: vi.fn(),
    findByIds: vi.fn(),
    list: vi.fn(),
    purge: vi.fn(),
    restore: vi.fn(),
  },
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: () =>
      mod.trpc.middleware(async (opts: any) => {
        if (opts.ctx.workspaceId && !['admin', 'owner'].includes(opts.ctx.workspaceRole)) {
          throw new Error('Requires admin role or higher');
        }
        return opts.next();
      }),
    wsCompatProcedure: mod.trpc.procedure,
  };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

vi.mock('@/server/services/trash', () => ({ TrashService: vi.fn(() => mocks.service) }));
vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: vi.fn(),
}));

const caller = (workspaceRole: 'admin' | 'member' | 'owner' | 'viewer' = 'viewer') =>
  trashRouter.createCaller({
    serverDB: {},
    userId: 'viewer',
    workspaceId: 'workspace-1',
    workspaceRole,
  } as any);

describe('trashRouter workspace resource permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(TrashService).mockImplementation(() => mocks.service as any);
    mocks.service.findByIds.mockResolvedValue([
      {
        deletedByUserId: 'member',
        id: 'trash-1',
        meta: { creatorUserId: 'creator', visibility: 'public' },
        resourceType: 'file',
        userId: 'creator',
      },
    ]);
    mocks.service.restore.mockResolvedValue({ failed: [], restored: [] });
    mocks.service.emptyTrash.mockResolvedValue({ scheduled: 0 });
    mocks.service.purge.mockResolvedValue({ failed: [], purged: 0, purgedIds: [] });
  });

  it('keeps Viewer restore read-only even for a public resource', async () => {
    vi.mocked(hasWorkspaceScopedPermission).mockResolvedValue(false);

    await expect(caller().restore({ ids: ['trash-1'] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.service.restore).not.toHaveBeenCalled();
  });

  it('checks every resource capability before emptying an unfiltered workspace bin', async () => {
    vi.mocked(hasWorkspaceScopedPermission).mockResolvedValue(false);

    await expect(caller('admin').emptyTrash()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(hasWorkspaceScopedPermission).toHaveBeenCalledTimes(3);
    expect(mocks.service.emptyTrash).not.toHaveBeenCalled();
  });

  it('keeps permanent deletion behind the workspace Admin/Owner gate', async () => {
    vi.mocked(hasWorkspaceScopedPermission).mockResolvedValue(true);

    await expect(caller('member').purge({ ids: ['trash-1'] })).rejects.toThrow(
      'Requires admin role or higher',
    );
    await expect(caller('member').emptyTrash()).rejects.toThrow('Requires admin role or higher');
    expect(mocks.service.purge).not.toHaveBeenCalled();
    expect(mocks.service.emptyTrash).not.toHaveBeenCalled();
  });

  it('allows a writable member to restore a visible resource', async () => {
    vi.mocked(hasWorkspaceScopedPermission).mockResolvedValue(true);

    await caller('member').restore({ ids: ['trash-1'] });

    expect(hasWorkspaceScopedPermission).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FILE_UPDATE', userId: 'viewer' }),
    );
    expect(mocks.service.restore).toHaveBeenCalledWith(['trash-1']);
  });

  it('never exposes another creator private resource through an explicit id', async () => {
    mocks.service.findByIds.mockResolvedValue([
      {
        id: 'trash-private',
        meta: { creatorUserId: 'creator', visibility: 'private' },
        resourceType: 'document',
      },
    ]);

    await expect(caller().restore({ ids: ['trash-private'] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(hasWorkspaceScopedPermission).not.toHaveBeenCalled();
  });
});
