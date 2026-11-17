// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanUseTopicTargets: vi.fn(),
  linkTopicPullRequest: vi.fn(async () => true),
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
}));
const Model = vi.fn(function () {
  return {};
});
vi.mock('@/database/models/message', () => ({ MessageModel: Model }));
vi.mock('@/database/models/work', () => ({ WorkModel: Model }));
vi.mock('@/database/models/topic', () => ({ TopicModel: Model }));
vi.mock('@/server/services/workRegistration', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  isBetterCodingExperienceEnabled: vi.fn(async () => true),
  linkTopicPullRequest: mocks.linkTopicPullRequest,
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
});
