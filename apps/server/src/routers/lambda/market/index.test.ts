// @vitest-environment node
import { MarketAPIError } from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDiscover = vi.hoisted(() => ({
  getAssistantDetail: vi.fn(),
  getGroupAgentDetail: vi.fn(),
  getMcpDetail: vi.fn(),
  getMcpManifest: vi.fn(),
  getModelDetail: vi.fn(),
  getPluginDetail: vi.fn(),
  getProviderDetail: vi.fn(),
  getUserInfo: vi.fn(),
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  marketUserInfo: vi.fn(function (opts: any) {
    return opts.next({ ctx: opts.ctx });
  }),
  serverDatabase: vi.fn(function (opts: any) {
    return opts.next(opts);
  }),
}));
// Sibling routers have their own suites and need the full middleware surface.
vi.mock('./agent', async () => ({ agentRouter: (await import('@/libs/trpc/lambda')).router({}) }));
vi.mock('./agentGroup', async () => ({
  agentGroupRouter: (await import('@/libs/trpc/lambda')).router({}),
}));
vi.mock('./creds', async () => ({ credsRouter: (await import('@/libs/trpc/lambda')).router({}) }));
vi.mock('./oidc', async () => ({ oidcRouter: (await import('@/libs/trpc/lambda')).router({}) }));
vi.mock('./skill', async () => ({ skillRouter: (await import('@/libs/trpc/lambda')).router({}) }));
vi.mock('./social', async () => ({
  socialRouter: (await import('@/libs/trpc/lambda')).router({}),
}));
vi.mock('./socialProfile', async () => ({
  socialProfileRouter: (await import('@/libs/trpc/lambda')).router({}),
}));
vi.mock('./user', async () => ({ userRouter: (await import('@/libs/trpc/lambda')).router({}) }));
vi.mock('@/business/server/lambda-routers/marketDeployments', async () => {
  const { router } = await import('@/libs/trpc/lambda');
  return { marketDeploymentsRouter: router({}) };
});
vi.mock('@/server/services/discover', () => ({
  DiscoverService: vi.fn(function () {
    return mockDiscover;
  }),
}));
vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(function () {
    return {};
  }),
}));

const createCaller = async () => {
  const { marketRouter } = await import('./index');
  return marketRouter.createCaller({ userId: 'user-1' } as any);
};

const detailCalls: Array<[string, (caller: any) => Promise<unknown>]> = [
  ['getAssistantDetail', (c) => c.getAssistantDetail({ identifier: 'x' })],
  ['getGroupAgentDetail', (c) => c.getGroupAgentDetail({ identifier: 'x' })],
  ['getMcpDetail', (c) => c.getMcpDetail({ identifier: 'x' })],
  ['getMcpManifest', (c) => c.getMcpManifest({ identifier: 'x' })],
  ['getModelDetail', (c) => c.getModelDetail({ identifier: 'x' })],
  ['getPluginDetail', (c) => c.getPluginDetail({ identifier: 'x' })],
  ['getProviderDetail', (c) => c.getProviderDetail({ identifier: 'x' })],
  ['getUserInfo', (c) => c.getUserInfo({ username: 'x' })],
];

describe('marketRouter detail procedures keep the upstream Market status', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(detailCalls)('%s maps a Market 404 to NOT_FOUND', async (name, call) => {
    mockDiscover[name as keyof typeof mockDiscover].mockRejectedValue(
      new MarketAPIError(404, 'Not Found'),
    );

    await expect(call(await createCaller())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each(detailCalls)('%s maps a Market 429 to TOO_MANY_REQUESTS', async (name, call) => {
    mockDiscover[name as keyof typeof mockDiscover].mockRejectedValue(
      new MarketAPIError(429, 'Too Many'),
    );

    await expect(call(await createCaller())).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('keeps a non-Market failure as INTERNAL_SERVER_ERROR with the fallback message', async () => {
    mockDiscover.getGroupAgentDetail.mockRejectedValue(new Error('boom: secret detail'));

    await expect(
      (await createCaller()).getGroupAgentDetail({ identifier: 'x' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to fetch group agent detail',
    });
  });
});
