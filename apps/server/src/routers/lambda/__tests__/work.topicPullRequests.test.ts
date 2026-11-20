// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanUseTopicTargets: vi.fn(),
  assertCanViewTopicTargets: vi.fn(),
  bindTopicPullRequestWake: vi.fn(async (): Promise<string> => 'bound'),
  linkTopicPullRequest: vi.fn(async (): Promise<Record<string, unknown> | null> => ({
    links: [{ identifier: 'a/b#1', linkedAt: 'x', source: 'manual', url: 'u' }],
  })),
  listTopicsByPullRequest: vi.fn(),
  releaseTopicPullRequestWake: vi.fn(async () => true),
  setTopicPullRequestDismissed: vi.fn(async () => true),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));
// Let the RBAC gate through: this file is about the conversation access guard.
vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: () => (opts: { next: () => unknown }) => opts.next(),
}));
vi.mock('../_helpers/conversationResourceGuard', () => ({
  assertCanUseTopicTargets: mocks.assertCanUseTopicTargets,
  assertCanViewTopicTargets: mocks.assertCanViewTopicTargets,
}));
const Model = vi.fn(function () {
  return {};
});
vi.mock('@/database/models/message', () => ({ MessageModel: Model }));
vi.mock('@/database/models/work', () => ({
  WorkModel: vi.fn(function () {
    return { listTopicsByPullRequest: mocks.listTopicsByPullRequest };
  }),
}));
vi.mock('@/database/models/topic', () => ({ TopicModel: Model }));
vi.mock('@/server/services/workRegistration', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  bindTopicPullRequestWake: mocks.bindTopicPullRequestWake,
  isBetterCodingExperienceEnabled: vi.fn(async () => true),
  linkTopicPullRequest: mocks.linkTopicPullRequest,
  releaseTopicPullRequestWake: mocks.releaseTopicPullRequestWake,
  setTopicPullRequestDismissed: mocks.setTopicPullRequestDismissed,
}));

const { workRouter } = await import('../work');

const caller = () =>
  workRouter.createCaller({ serverDB: {}, userId: 'user-1', workspaceId: 'ws-1' } as any);

describe('workRouter — topic PR links honour conversation access', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to link or remove a PR on a topic the caller cannot use', async () => {
    mocks.assertCanUseTopicTargets.mockRejectedValue(new Error('FORBIDDEN'));

    await expect(
      caller().linkTopicPullRequest({
        source: 'manual',
        topicId: 't1',
        url: 'https://github.com/a/b/pull/1',
      }),
    ).rejects.toThrow('FORBIDDEN');
    await expect(
      caller().setTopicPullRequestDismissed({
        dismissed: true,
        identifier: 'a/b#1',
        topicId: 't1',
      }),
    ).rejects.toThrow('FORBIDDEN');

    expect(mocks.assertCanUseTopicTargets).toHaveBeenCalledWith(
      { db: {}, userId: 'user-1', workspaceId: 'ws-1' },
      ['t1'],
    );
    expect(mocks.linkTopicPullRequest).not.toHaveBeenCalled();
    expect(mocks.setTopicPullRequestDismissed).not.toHaveBeenCalled();
    expect(mocks.bindTopicPullRequestWake).not.toHaveBeenCalled();
    expect(mocks.releaseTopicPullRequestWake).not.toHaveBeenCalled();
  });

  it('writes once access is confirmed', async () => {
    mocks.assertCanUseTopicTargets.mockResolvedValue([]);

    expect(
      await caller().linkTopicPullRequest({
        source: 'manual',
        topicId: 't1',
        url: 'https://github.com/a/b/pull/1',
      }),
    ).toEqual({ identifier: 'a/b#1', linked: true });
    expect(
      await caller().setTopicPullRequestDismissed({
        dismissed: true,
        identifier: 'a/b#1',
        topicId: 't1',
      }),
    ).toEqual({ updated: true });
  });

  it("binds Auto-fix in the caller's own scope once the topic lists the PR", async () => {
    mocks.assertCanUseTopicTargets.mockResolvedValue([]);

    for (const source of ['manual', 'branch'] as const) {
      mocks.bindTopicPullRequestWake.mockClear();
      await caller().linkTopicPullRequest({
        source,
        topicId: 't1',
        url: 'https://github.com/a/b/pull/1',
      });
      expect(mocks.bindTopicPullRequestWake).toHaveBeenCalledWith({
        db: {},
        pr: expect.objectContaining({ number: 1, repoFullName: 'a/b' }),
        scope: { userId: 'user-1', workspaceId: 'ws-1' },
        topicId: 't1',
        topicModel: expect.anything(),
      });
    }
  });

  it('binds nothing for a PR the topic keeps removed, or a link that was not saved', async () => {
    mocks.assertCanUseTopicTargets.mockResolvedValue([]);
    const branch = {
      source: 'branch' as const,
      topicId: 't1',
      url: 'https://github.com/a/b/pull/1',
    };

    mocks.linkTopicPullRequest.mockResolvedValueOnce({ dismissed: ['a/b#1'] });
    expect(await caller().linkTopicPullRequest(branch)).toEqual({
      identifier: 'a/b#1',
      linked: true,
    });
    mocks.linkTopicPullRequest.mockResolvedValueOnce(null);
    expect(await caller().linkTopicPullRequest(branch)).toEqual({
      identifier: 'a/b#1',
      linked: false,
    });
    expect(mocks.bindTopicPullRequestWake).not.toHaveBeenCalled();
  });

  it('never fails the link over Auto-fix', async () => {
    mocks.assertCanUseTopicTargets.mockResolvedValue([]);
    mocks.bindTopicPullRequestWake.mockRejectedValueOnce(new Error('db down'));

    expect(
      await caller().linkTopicPullRequest({
        source: 'manual',
        topicId: 't1',
        url: 'https://github.com/a/b/pull/1',
      }),
    ).toEqual({ identifier: 'a/b#1', linked: true });
  });

  it('releases the link-held conversation when the PR is removed, not when it is shown again', async () => {
    mocks.assertCanUseTopicTargets.mockResolvedValue([]);
    const input = { identifier: 'Owner.x/repo-y#12', topicId: 't1' };

    await caller().setTopicPullRequestDismissed({ ...input, dismissed: true });
    expect(mocks.releaseTopicPullRequestWake).toHaveBeenCalledWith({
      db: {},
      pr: { number: 12, repoFullName: 'Owner.x/repo-y' },
      topicId: 't1',
      topicModel: expect.anything(),
    });

    mocks.releaseTopicPullRequestWake.mockClear();
    await caller().setTopicPullRequestDismissed({ ...input, dismissed: false });
    mocks.setTopicPullRequestDismissed.mockResolvedValueOnce(false);
    expect(await caller().setTopicPullRequestDismissed({ ...input, dismissed: true })).toEqual({
      updated: false,
    });
    expect(mocks.releaseTopicPullRequestWake).not.toHaveBeenCalled();

    mocks.releaseTopicPullRequestWake.mockRejectedValueOnce(new Error('db down'));
    expect(await caller().setTopicPullRequestDismissed({ ...input, dismissed: true })).toEqual({
      updated: true,
    });
  });

  it('looks up the PR identity and omits conversations the caller cannot view', async () => {
    mocks.listTopicsByPullRequest.mockResolvedValue([
      { agentId: 'agent-1', groupId: null, sessionId: null, title: 'Visible', topicId: 'visible' },
      { agentId: 'agent-2', groupId: null, sessionId: null, title: 'Hidden', topicId: 'hidden' },
    ]);
    mocks.assertCanViewTopicTargets.mockImplementation(async (_ctx, [topicId]) => {
      if (topicId === 'hidden') throw new TRPCError({ code: 'FORBIDDEN' });
      return [];
    });

    expect(
      await caller().lookupPullRequest({ url: 'https://github.com/a/b/pull/1/files#diff' }),
    ).toEqual({
      data: [{ agentId: 'agent-1', groupId: null, title: 'Visible', topicId: 'visible' }],
      success: true,
    });
    expect(mocks.listTopicsByPullRequest).toHaveBeenCalledWith('a/b#1');
  });

  it('bounds concurrent permission checks while returning every visible conversation in order', async () => {
    const topics = Array.from({ length: 21 }, (_, index) => ({
      agentId: `agent-${index}`,
      groupId: null,
      sessionId: null,
      title: `Topic ${index}`,
      topicId: `topic-${index}`,
    }));
    mocks.listTopicsByPullRequest.mockResolvedValue(topics);
    let active = 0;
    let peak = 0;
    mocks.assertCanViewTopicTargets.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return [];
    });

    const result = await caller().lookupPullRequest({ url: 'https://github.com/a/b/pull/1' });

    expect(result.data.map((topic) => topic.topicId)).toEqual(topics.map((topic) => topic.topicId));
    expect(peak).toBeLessThanOrEqual(10);
  });

  it('rejects links to GitHub issues before looking up associations', async () => {
    await expect(
      caller().lookupPullRequest({ url: 'https://github.com/a/b/issues/1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.listTopicsByPullRequest).not.toHaveBeenCalled();
  });
});
