import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { TopicService } from './index';

vi.mock('@/libs/trpc/client', () => ({
  createWorkspaceLambdaClient: vi.fn(),
  lambdaClient: { topic: { searchTopics: { query: vi.fn(async () => []) } } },
}));

describe('TopicService.searchTopics', () => {
  beforeEach(() => {
    vi.mocked(lambdaClient.topic.searchTopics.query).mockClear();
  });

  /** @example A sidebar search with "only mine" on must not return teammates' topics. */
  it('forwards the workspace only-mine filter', async () => {
    await new TopicService().searchTopics('release', 'agt_1', undefined, true);

    expect(lambdaClient.topic.searchTopics.query).toHaveBeenCalledWith({
      agentId: 'agt_1',
      groupId: undefined,
      keywords: 'release',
      onlyMine: true,
    });
  });

  it('omits the filter when it is off', async () => {
    await new TopicService().searchTopics('release', 'agt_1');

    expect(lambdaClient.topic.searchTopics.query).toHaveBeenCalledWith(
      expect.objectContaining({ onlyMine: undefined }),
    );
  });
});
