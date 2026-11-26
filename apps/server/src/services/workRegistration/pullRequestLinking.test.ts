import { describe, expect, it, vi } from 'vitest';

import { createShellPullRequestLinking } from './pullRequestLinking';

vi.mock('@/database/models/scm', () => ({
  ScmChangeRequestModel: { listOpenByHeadRefs: vi.fn() },
}));
vi.mock('@/database/models/user', () => ({ UserModel: vi.fn() }));

describe('createShellPullRequestLinking', () => {
  it('re-reads the topic pull requests for each command, so a PR linked earlier in the run resolves', async () => {
    const listTopicPullRequests = vi
      .fn()
      .mockResolvedValueOnce([{ identifier: 'a/b#1' }])
      .mockResolvedValueOnce([{ identifier: 'a/b#2' }, { identifier: 'a/b#1' }]);
    const linking = createShellPullRequestLinking({
      db: {} as any,
      topicId: 't1',
      userId: 'u1',
      workModel: { listTopicPullRequests } as any,
    });

    expect(await linking.listTopicPullRequestIds()).toEqual(['a/b#1']);
    // `gh pr create` then registered a/b#2; the next bare `gh pr merge 2` must see it.
    expect(await linking.listTopicPullRequestIds()).toEqual(['a/b#2', 'a/b#1']);
    expect(listTopicPullRequests).toHaveBeenCalledTimes(2);
  });
});
