// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRouter } from './agent';

const { mockMarketSDK, mockCreateAgentVersionHeader } = vi.hoisted(() => {
  const mockCreateAgentVersionHeader = vi.fn();
  const mockMarketSDK = {
    agents: {
      createAgent: vi.fn(),
      createAgentVersion: vi.fn(async () => {
        mockCreateAgentVersionHeader(mockMarketSDK.headers['x-lobe-owner-account-id']);
        return { success: true };
      }),
      getAgentDetail: vi.fn(),
    },
    headers: {} as Record<string, string>,
  };

  return { mockCreateAgentVersionHeader, mockMarketSDK };
});

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(function () {
    return (opts: any) => opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(function () {
    return {
      getUserState: vi.fn(async () => ({ settings: {} })),
    };
  }),
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  marketSDK: vi.fn(function (opts: any) {
    return opts.next({
      ctx: {
        ...opts.ctx,
        marketSDK: mockMarketSDK,
      },
    });
  }),
  marketUserInfo: vi.fn(function (opts: any) {
    return opts.next({
      ctx: {
        ...opts.ctx,
        marketUserInfo: { email: 'actor@example.com', name: 'Actor', userId: 'user-1' },
      },
    });
  }),
  serverDatabase: vi.fn(function (opts: any) {
    return opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn(function () {
    return 'trust-token';
  }),
}));

describe('agentRouter.publishOrCreate', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMarketSDK.headers = {};
    mockMarketSDK.agents.getAgentDetail.mockResolvedValue({
      identifier: 'existing-agent',
      name: 'Existing Agent',
      ownerId: 123,
    });
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ accountId: 999, sub: 'user-1' }), {
        status: 200,
      }),
    );
  });

  it('uses the acting organization account for ownership checks and version uploads', async () => {
    const caller = agentRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

    const result = await caller.publishOrCreate({
      actAs: 123,
      identifier: 'existing-agent',
      name: 'Existing Agent',
    });

    expect(result).toEqual({
      identifier: 'existing-agent',
      isNewAgent: false,
      success: true,
    });
    expect(mockMarketSDK.agents.createAgent).not.toHaveBeenCalled();
    expect(mockMarketSDK.agents.createAgentVersion).toHaveBeenCalledWith({
      identifier: 'existing-agent',
      name: 'Existing Agent',
    });
    expect(mockCreateAgentVersionHeader).toHaveBeenCalledWith('123');
    expect(mockMarketSDK.headers['x-lobe-owner-account-id']).toBeUndefined();
  });
});

describe('agentRouter.getOnboardingFull', () => {
  const caller = () => agentRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns the upstream catalog when Market accepts the request', async () => {
    const catalog = { writing: [{ identifier: 'writer', name: 'Writer' }] };
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(catalog), { status: 200 }));

    await expect(caller().getOnboardingFull({ locale: 'en-US' })).resolves.toEqual(catalog);
  });

  it.each([401, 403])('returns an empty catalog when Market answers %s', async (status) => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'unauthorized',
          error_description: 'Missing bearer token',
        }),
        {
          status,
          statusText: status === 401 ? 'Unauthorized' : 'Forbidden',
        },
      ),
    );

    await expect(caller().getOnboardingFull()).resolves.toEqual({});
  });

  it.each([
    [404, 'Not Found'],
    [500, 'Internal Server Error'],
    [503, 'Service Unavailable'],
  ])('still throws when Market answers %s', async (status, statusText) => {
    fetchSpy.mockResolvedValue(new Response('unavailable', { status, statusText }));

    await expect(caller().getOnboardingFull()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to get onboarding full: ${statusText}`,
    });
  });

  it('still throws when the Market request fails', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));

    await expect(caller().getOnboardingFull()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'network down',
    });
  });
});
