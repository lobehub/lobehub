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
