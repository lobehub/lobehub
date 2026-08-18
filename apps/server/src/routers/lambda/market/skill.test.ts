// @vitest-environment node
import { MarketAPIError } from '@lobehub/market-sdk';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSkillComments,
  mockGetSkillDetail,
  mockGetSkillDownloadUrl,
  mockGetSkillRatingDistribution,
  mockSearchSkill,
} = vi.hoisted(() => ({
  mockGetSkillComments: vi.fn(),
  mockGetSkillDetail: vi.fn(),
  mockGetSkillDownloadUrl: vi.fn(),
  mockGetSkillRatingDistribution: vi.fn(),
  mockSearchSkill: vi.fn(),
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
  serverDatabase: vi.fn((opts: any) => opts.next(opts)),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(() => ({
    getSkillComments: mockGetSkillComments,
    getSkillDetail: mockGetSkillDetail,
    getSkillDownloadUrl: mockGetSkillDownloadUrl,
    getSkillRatingDistribution: mockGetSkillRatingDistribution,
    searchSkill: mockSearchSkill,
  })),
}));

const createCaller = async () => {
  const { skillRouter } = await import('./skill');
  return skillRouter.createCaller({ userId: 'user-1' } as any);
};

const rawDetail = {
  category: 'productivity-tasks',
  content: '# SKILL.md',
  identifier: 'github.acme.skill-a',
  name: 'Skill A',
};

describe('skillRouter.getSkillDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSkillDetail.mockResolvedValue(rawDetail);
    mockGetSkillDownloadUrl.mockReturnValue('https://market.example/skills/skill-a/download');
  });

  it('enriches the raw detail with downloadUrl', async () => {
    const caller = await createCaller();

    const result = await caller.getSkillDetail({
      identifier: 'github.acme.skill-a',
      locale: 'en-US',
    });

    expect(mockGetSkillDetail).toHaveBeenCalledWith('github.acme.skill-a', {
      locale: 'en-US',
      version: undefined,
    });
    expect(result.downloadUrl).toBe('https://market.example/skills/skill-a/download');
    expect(result.name).toBe('Skill A');
  });

  it('stays a single upstream request — never fans out to the skill list', async () => {
    // The detail query also backs per-skill icon/metadata lookups (one per
    // installed skill in the chat tools panel). Related skills must be
    // composed client-side from getSkillList, not aggregated here.
    const caller = await createCaller();

    await caller.getSkillDetail({ identifier: 'github.acme.skill-a' });

    expect(mockGetSkillDetail).toHaveBeenCalledTimes(1);
    expect(mockSearchSkill).not.toHaveBeenCalled();
  });

  it('passes the requested version through to detail and download URL', async () => {
    const caller = await createCaller();

    await caller.getSkillDetail({ identifier: 'github.acme.skill-a', version: '1.2.0' });

    expect(mockGetSkillDetail).toHaveBeenCalledWith('github.acme.skill-a', {
      locale: undefined,
      version: '1.2.0',
    });
    expect(mockGetSkillDownloadUrl).toHaveBeenCalledWith('github.acme.skill-a', '1.2.0');
  });

  it('wraps detail failures into an internal server error', async () => {
    mockGetSkillDetail.mockRejectedValue(new Error('boom'));
    const caller = await createCaller();

    await expect(caller.getSkillDetail({ identifier: 'github.acme.skill-a' })).rejects.toThrow(
      'Failed to fetch skill detail',
    );
  });
});

describe('skillRouter.getSkillComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards pagination params and returns the comment page', async () => {
    const response = {
      currentPage: 2,
      items: [{ content: 'Great skill', id: 1 }],
      pageSize: 10,
      totalCount: 11,
      totalPages: 2,
    };
    mockGetSkillComments.mockResolvedValue(response);
    const caller = await createCaller();

    const result = await caller.getSkillComments({
      identifier: 'github.acme.skill-a',
      order: 'desc',
      page: 2,
      pageSize: 10,
      sort: 'createdAt',
    });

    expect(mockGetSkillComments).toHaveBeenCalledWith('github.acme.skill-a', {
      order: 'desc',
      page: 2,
      pageSize: 10,
      sort: 'createdAt',
    });
    expect(result).toEqual(response);
  });

  it('wraps comment failures into an internal server error', async () => {
    mockGetSkillComments.mockRejectedValue(new Error('boom'));
    const caller = await createCaller();

    await expect(caller.getSkillComments({ identifier: 'github.acme.skill-a' })).rejects.toThrow(
      'Failed to fetch skill comments',
    );
  });
});

describe('skillRouter.getSkillRatingDistribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the rating distribution for a skill', async () => {
    const distribution = { 1: 0, 2: 1, 3: 2, 4: 10, 5: 30, totalCount: 43 };
    mockGetSkillRatingDistribution.mockResolvedValue(distribution);
    const caller = await createCaller();

    const result = await caller.getSkillRatingDistribution({
      identifier: 'github.acme.skill-a',
    });

    expect(mockGetSkillRatingDistribution).toHaveBeenCalledWith('github.acme.skill-a');
    expect(result).toEqual(distribution);
  });

  it('wraps distribution failures into an internal server error', async () => {
    mockGetSkillRatingDistribution.mockRejectedValue(new Error('boom'));
    const caller = await createCaller();

    await expect(
      caller.getSkillRatingDistribution({ identifier: 'github.acme.skill-a' }),
    ).rejects.toThrow('Failed to fetch skill rating distribution');
  });
});

describe('skillRouter.getSkillList error mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Collapsing an upstream 429 into a blanket 500 is what made the skill store
   * fail on open: the client could not tell a throttle from an outage, so SWR
   * retried on a 1s/2s/4s/8s/16s backoff and every retry landed back inside the
   * rate-limit window, keeping the bucket empty.
   */
  it('surfaces an upstream rate limit as TOO_MANY_REQUESTS, not a blanket 500', async () => {
    mockSearchSkill.mockRejectedValue(
      new MarketAPIError(429, 'Too Many Requests', {
        error: 'Too many requests. Please try again later.',
      }),
    );
    const caller = await createCaller();

    await expect(caller.getSkillList({ page: 1 })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
  });

  it.each([
    [400, 'BAD_REQUEST'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
  ])('maps upstream %i to %s', async (status, code) => {
    mockSearchSkill.mockRejectedValue(new MarketAPIError(status, 'nope', undefined));
    const caller = await createCaller();

    await expect(caller.getSkillList({ page: 1 })).rejects.toMatchObject({ code });
  });

  /**
   * `UNAUTHORIZED` drives re-authentication UI: `createResponseMeta` tags it
   * with `X-Auth-Required` (unless it carries the Market sentinel message) and
   * the desktop proxy opens the LobeHub re-login prompt on that header. These
   * are `publicProcedure`s authenticated by the server's trusted-client token,
   * so an upstream 401 is our misconfiguration — it must never ask the user to
   * sign in again.
   */
  it('never maps an upstream 401 onto the app re-auth path', async () => {
    mockSearchSkill.mockRejectedValue(new MarketAPIError(401, 'invalid_token', undefined));
    const caller = await createCaller();

    const error = await caller.getSkillList({ page: 1 }).catch((e) => e);

    expect(error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(error.code).not.toBe('UNAUTHORIZED');
  });

  it('falls back to INTERNAL_SERVER_ERROR for unmapped upstream statuses', async () => {
    mockSearchSkill.mockRejectedValue(new MarketAPIError(503, 'Service Unavailable', undefined));
    const caller = await createCaller();

    await expect(caller.getSkillList({ page: 1 })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });

  it('wraps non-Market failures into an internal server error', async () => {
    mockSearchSkill.mockRejectedValue(new Error('boom'));
    const caller = await createCaller();

    const error = await caller.getSkillList({ page: 1 }).catch((e) => e);

    expect(error).toBeInstanceOf(TRPCError);
    expect(error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(error.message).toBe('Failed to fetch skill list');
  });
});
