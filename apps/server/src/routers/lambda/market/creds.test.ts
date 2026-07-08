// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockOrgCredsList, mockPersonalCredsList } = vi.hoisted(() => ({
  mockOrgCredsList: vi.fn(async () => ({ data: [{ id: 1, key: 'ORG_SECRET' }] })),
  mockPersonalCredsList: vi.fn(async () => ({ data: [{ id: 2, key: 'PERSONAL_SECRET' }] })),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withRbacPermission: vi.fn(() => (opts: any) => opts.next(opts)),
}));

// Simulates the real `cloudWorkspaceAuth`: strips `workspaceId` off the
// context unless the caller is flagged as a workspace member. This is the
// gate `credsAccessor` must never be reachable around — regression test for
// the P1 finding where `ctx.workspaceId` (raw off `X-Workspace-Id`) was read
// before any membership check existed.
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', () => ({
  cloudWorkspaceAuth: vi.fn((opts: any) =>
    opts.next({
      ctx: {
        ...opts.ctx,
        workspaceId: opts.ctx.isWorkspaceMember ? opts.ctx.workspaceId : undefined,
      },
    }),
  ),
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  marketUserInfo: vi.fn((opts: any) =>
    opts.next({
      ctx: {
        ...opts.ctx,
        marketUserInfo: { email: 'actor@example.com', name: 'Actor', userId: 'user-1' },
      },
    }),
  ),
  requireMarketAuth: vi.fn((opts: any) => opts.next(opts)),
  serverDatabase: vi.fn((opts: any) => opts.next(opts)),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(() => ({
    market: {
      creds: { list: mockPersonalCredsList },
      organizations: {
        creds: vi.fn(() => ({ list: mockOrgCredsList })),
      },
    },
  })),
}));

describe('credsRouter workspace routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes to organization creds only when the caller is a verified workspace member', async () => {
    const { credsRouter } = await import('./creds');

    const caller = credsRouter.createCaller({
      isWorkspaceMember: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    const result = await caller.list();

    expect(mockOrgCredsList).toHaveBeenCalledTimes(1);
    expect(mockPersonalCredsList).not.toHaveBeenCalled();
    expect(result.data).toEqual([{ id: 1, key: 'ORG_SECRET' }]);
  });

  it('falls back to personal creds when the caller sends a workspaceId it is not a member of', async () => {
    const { credsRouter } = await import('./creds');

    // Simulates a request forging `X-Workspace-Id` for a workspace the caller
    // does not belong to — cloudWorkspaceAuth (mocked above) must strip it
    // before `credsAccessor` ever sees it.
    const caller = credsRouter.createCaller({
      isWorkspaceMember: false,
      userId: 'user-1',
      workspaceId: 'someone-elses-workspace',
    } as any);

    const result = await caller.list();

    expect(mockPersonalCredsList).toHaveBeenCalledTimes(1);
    expect(mockOrgCredsList).not.toHaveBeenCalled();
    expect(result.data).toEqual([{ id: 2, key: 'PERSONAL_SECRET' }]);
  });
});
