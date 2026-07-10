// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { socialProfileRouter } from './socialProfile';

const { mockMarketSDKHeaders } = vi.hoisted(() => ({
  mockMarketSDKHeaders: {
    Authorization: 'Bearer market-token',
  },
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  marketSDK: vi.fn((opts: any) =>
    opts.next({
      ctx: {
        ...opts.ctx,
        marketSDK: {
          headers: mockMarketSDKHeaders,
        },
      },
    }),
  ),
  marketUserInfo: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

describe('socialProfileRouter.submitRepo', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: 'submitted' }), {
        status: 200,
      }),
    );
  });

  it('attributes workspace skill repo submissions to the acting organization account', async () => {
    const caller = socialProfileRouter.createCaller({ userId: 'user-1' } as any);

    await caller.submitRepo({
      actAs: 123,
      gitUrl: 'https://github.com/lobehub/example-skill',
      type: 'skill',
    });

    const call = fetchSpy.mock.calls[0] as [string, RequestInit] | undefined;
    expect(String(call?.[0])).toMatch(/\/api\/v1\/user\/claims\/submit-repo$/);
    expect((call?.[1]?.headers as Record<string, string>)['x-lobe-owner-account-id']).toBe('123');
  });
});
