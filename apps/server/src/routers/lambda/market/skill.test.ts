// @vitest-environment node
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
