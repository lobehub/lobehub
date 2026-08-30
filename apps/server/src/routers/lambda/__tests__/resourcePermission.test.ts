// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { canManageResourcePermission, getResourceMeta } from '@/server/services/resourcePermission';

import { resourcePermissionRouter } from '../resourcePermission';

// `vi.mock` is hoisted above the imports at runtime, so the mocks are active
// when the router module is evaluated. Kept below the imports to satisfy
// `import-x/first`.
vi.mock('@/database/models/resourcePermission', () => ({ ResourcePermissionModel: vi.fn() }));
vi.mock('../_helpers/workspaceAgentGuard', () => ({
  getWorkspaceGroupVirtualAgentIds: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/server/services/resourcePermission', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    canManageResourcePermission: vi.fn(),
    getResourceMeta: vi.fn(),
  };
});
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  // The real `wsCompatProcedure` validates a Better-Auth session; for unit tests
  // we skip auth and rely on the test ctx already carrying userId/workspaceId.
  return {
    requireWorkspaceRoleWhenScoped: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

const getResourceMetaMock = vi.mocked(getResourceMeta);
const canManageMock = vi.mocked(canManageResourcePermission);

describe('resourcePermissionRouter.setGeneralAccess', () => {
  let permissionModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    permissionModelMock = { setAccessLevel: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(ResourcePermissionModel).mockImplementation(() => permissionModelMock);
  });

  const caller = () =>
    resourcePermissionRouter.createCaller({
      serverDB: {},
      userId: 'user_creator',
      workspaceId: 'ws_1',
    } as any);

  // Regression: the response used to hard-code `visibility: 'public'`, so saving a
  // pre-publish access level on a private agent made the shared SWR cache report it
  // as public until the next refetch.
  it('keeps a private resource private in the returned state', async () => {
    getResourceMetaMock.mockResolvedValue({
      userId: 'user_creator',
      visibility: 'private',
      workspaceId: 'ws_1',
    } as any);
    canManageMock.mockResolvedValue(true);

    const result = await caller().setGeneralAccess({
      accessLevel: 'use',
      resourceId: 'agent-1',
      resourceType: 'agent',
    });

    expect(permissionModelMock.setAccessLevel).toHaveBeenCalledWith(
      'agent',
      'agent-1',
      'use',
      'user_creator',
    );
    expect(result.visibility).toBe('private');
  });

  // Regression: `viewer` used to be resolved through the resource default, which
  // was `use` at the time. Once the Agent / Group default became `edit`, that
  // path would have handed edit access to a released client that explicitly
  // asked for the non-editor option.
  it.each([
    ['agent', 'use'],
    ['agentGroup', 'use'],
    ['document', 'view'],
  ] as const)('maps a legacy %s viewer role to %s, not to the default', async (type, expected) => {
    getResourceMetaMock.mockResolvedValue({
      userId: 'user_creator',
      visibility: 'public',
      workspaceId: 'ws_1',
    } as any);
    canManageMock.mockResolvedValue(true);

    const result = await caller().setGeneralAccess({
      resourceId: 'resource-1',
      resourceType: type,
      role: 'viewer',
    });

    expect(permissionModelMock.setAccessLevel).toHaveBeenCalledWith(
      type,
      'resource-1',
      expected,
      'user_creator',
    );
    expect(result.accessLevel).toBe(expected);
  });

  it('reports public resources as public', async () => {
    getResourceMetaMock.mockResolvedValue({
      userId: 'user_creator',
      visibility: 'public',
      workspaceId: 'ws_1',
    } as any);
    canManageMock.mockResolvedValue(true);

    const result = await caller().setGeneralAccess({
      accessLevel: 'use',
      resourceId: 'agent-1',
      resourceType: 'agent',
    });

    expect(result.visibility).toBe('public');
  });
});

/**
 * Fake drizzle db resolving one prepared result per `select()` call, in order.
 * Records whether a query was locked (`.for('update')`) and whether it ran
 * inside a transaction, so the serialisation contract can be asserted — the
 * fake cannot reproduce real locking, but it can prove the query asks for it.
 */
const dbWithResults = (...results: unknown[][]) => {
  let call = 0;
  const calls: { inTransaction: boolean; locked: boolean }[] = [];
  let depth = 0;
  const next = () => {
    const index = calls.length;
    calls.push({ inTransaction: depth > 0, locked: false });
    const promise = Promise.resolve(results[call++] ?? []);
    return Object.assign(promise, {
      for: () => {
        calls[index].locked = true;
        return promise;
      },
    });
  };
  const db: any = {
    calls,
    select: () => ({ from: () => ({ where: next }) }),
    transaction: async (cb: (tx: unknown) => unknown) => {
      depth += 1;
      try {
        return await cb(db);
      } finally {
        depth -= 1;
      }
    },
  };
  return db;
};

describe('resourcePermissionRouter collaborators', () => {
  let collaboratorModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    collaboratorModelMock = {
      listCollaborators: vi.fn().mockResolvedValue([]),
      removeCollaborators: vi.fn().mockResolvedValue(undefined),
      upsertCollaborators: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(ResourcePermissionModel).mockImplementation(() => collaboratorModelMock);
    getResourceMetaMock.mockResolvedValue({
      userId: 'user_creator',
      visibility: 'public',
      workspaceId: 'ws_1',
    } as any);
    canManageMock.mockResolvedValue(true);
  });

  const caller = (serverDB: unknown = dbWithResults()) =>
    resourcePermissionRouter.createCaller({
      serverDB,
      userId: 'user_creator',
      workspaceId: 'ws_1',
    } as any);

  it('grants active members and silently skips the creator', async () => {
    const db = dbWithResults([{ userId: 'member_a' }, { userId: 'member_b' }]);

    const result = await caller(db).addCollaborators({
      accessLevel: 'edit',
      resourceId: 'kb-1',
      resourceType: 'knowledgeBase',
      userIds: ['member_a', 'member_b', 'user_creator', 'member_a'],
    });

    expect(result).toEqual({ success: true });
    expect(collaboratorModelMock.upsertCollaborators).toHaveBeenCalledWith({
      accessLevel: 'edit',
      createdBy: 'user_creator',
      resourceId: 'kb-1',
      resourceType: 'knowledgeBase',
      userIds: ['member_a', 'member_b'],
    });
  });

  it('locks the membership rows it checks, inside the transaction that writes the grants', async () => {
    const db = dbWithResults([{ userId: 'member_a' }]);

    await caller(db).addCollaborators({
      accessLevel: 'edit',
      resourceId: 'kb-1',
      resourceType: 'knowledgeBase',
      userIds: ['member_a'],
    });

    // Without both, a membership removal committing between the check and the
    // upsert leaves a grant that re-inviting the member would revive.
    expect(db.calls).toEqual([{ inTransaction: true, locked: true }]);
  });

  it('rejects a target that is not an active workspace member', async () => {
    const db = dbWithResults([{ userId: 'member_a' }]);

    await expect(
      caller(db).addCollaborators({
        accessLevel: 'edit',
        resourceId: 'kb-1',
        resourceType: 'knowledgeBase',
        userIds: ['member_a', 'departed'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(collaboratorModelMock.upsertCollaborators).not.toHaveBeenCalled();
  });

  it('rejects a level the resource type does not support', async () => {
    await expect(
      caller().addCollaborators({
        accessLevel: 'view',
        resourceId: 'kb-1',
        resourceType: 'knowledgeBase',
        userIds: ['member_a'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('requires manage authority on every collaborator procedure', async () => {
    canManageMock.mockResolvedValue(false);

    await expect(
      caller().listCollaborators({ resourceId: 'kb-1', resourceType: 'knowledgeBase' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller().addCollaborators({
        accessLevel: 'edit',
        resourceId: 'kb-1',
        resourceType: 'knowledgeBase',
        userIds: ['member_a'],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller().removeCollaborator({
        resourceId: 'kb-1',
        resourceType: 'knowledgeBase',
        userId: 'member_a',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('hides a foreign private resource as NOT_FOUND', async () => {
    getResourceMetaMock.mockResolvedValue({
      userId: 'someone_else',
      visibility: 'private',
      workspaceId: 'ws_1',
    } as any);

    await expect(
      caller().listCollaborators({ resourceId: 'kb-1', resourceType: 'knowledgeBase' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists grants joined with member profiles', async () => {
    collaboratorModelMock.listCollaborators.mockResolvedValue([
      { accessLevel: 'edit', createdAt: new Date('2026-01-01'), userId: 'member_a' },
      { accessLevel: 'edit', createdAt: new Date('2026-01-02'), userId: 'member_gone' },
    ]);
    const db = dbWithResults([
      {
        avatar: null,
        email: 'a@example.com',
        fullName: 'Member A',
        id: 'member_a',
        username: 'membera',
      },
    ]);

    const result = await caller(db).listCollaborators({
      resourceId: 'kb-1',
      resourceType: 'knowledgeBase',
    });

    expect(result).toHaveLength(2);
    expect(result[0].user?.fullName).toBe('Member A');
    // A deleted account keeps the grant row visible so it can still be revoked.
    expect(result[1].user).toBeNull();
  });

  it('removes one member grant', async () => {
    const result = await caller().removeCollaborator({
      resourceId: 'kb-1',
      resourceType: 'knowledgeBase',
      userId: 'member_a',
    });

    expect(result).toEqual({ success: true });
    expect(collaboratorModelMock.removeCollaborators).toHaveBeenCalledWith(
      'knowledgeBase',
      'kb-1',
      ['member_a'],
    );
  });
});
