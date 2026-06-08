// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentGroupRouter } from './agentGroup';

const { mockMarketSDK } = vi.hoisted(() => ({
  mockMarketSDK: {
    agentGroups: {
      getAgentGroupDetail: vi.fn(),
    },
    headers: {} as Record<string, string>,
  },
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(() => ({
    getUserState: vi.fn(async () => ({ settings: {} })),
  })),
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  marketSDK: vi.fn((opts: any) =>
    opts.next({
      ctx: {
        ...opts.ctx,
        marketSDK: mockMarketSDK,
      },
    }),
  ),
  marketUserInfo: vi.fn((opts: any) =>
    opts.next({
      ctx: {
        ...opts.ctx,
        marketUserInfo: { email: 'actor@example.com', name: 'Actor', userId: 'user-1' },
      },
    }),
  ),
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn(() => 'trust-token'),
}));

describe('agentGroupRouter.forkAgentGroup', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMarketSDK.headers = {};
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          group: { identifier: 'forked-group' },
          groupVersion: { versionNumber: 1 },
          memberAgents: [],
        }),
        { status: 200 },
      ),
    );
  });

  it('attributes workspace forks to the acting organization account', async () => {
    const caller = agentGroupRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

    await caller.forkAgentGroup({
      actAs: 321,
      identifier: 'forked-group',
      name: 'Forked Group',
      sourceIdentifier: 'source-group',
      status: 'published',
      visibility: 'public',
    } as unknown as Parameters<typeof caller.forkAgentGroup>[0]);

    const [, requestInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((requestInit.headers as Record<string, string>)['x-lobe-owner-account-id']).toBe('321');
  });
});

describe('agentGroupRouter.checkOwnership', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMarketSDK.agentGroups.getAgentGroupDetail.mockResolvedValue({
      group: {
        avatar: '👥',
        identifier: 'workspace-group',
        name: 'Workspace Group',
        ownerId: 321,
      },
    });
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ accountId: 999, sub: 'user-1' }), {
        status: 200,
      }),
    );
  });

  it('uses the acting organization account when checking workspace-owned groups', async () => {
    const caller = agentGroupRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

    const result = await caller.checkOwnership({
      actAs: 321,
      identifier: 'workspace-group',
    } as unknown as Parameters<typeof caller.checkOwnership>[0]);

    expect(result).toMatchObject({
      exists: true,
      isOwner: true,
      originalGroup: null,
    });
  });
});
