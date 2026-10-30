import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { TopicService } from './index';

vi.mock('@/libs/trpc/client', () => ({
  createWorkspaceLambdaClient: vi.fn(),
  lambdaClient: { topic: { getTopics: { query: vi.fn(async () => ({ items: [], total: 0 })) } } },
}));

describe('TopicService channel history visibility', () => {
  beforeEach(() => {
    vi.mocked(lambdaClient.topic.getTopics.query).mockClear();
  });

  it.each([0, 1])('excludes channel topics before pagination for page %s', async (current) => {
    await new TopicService().getTopics({
      agentId: 'agent',
      current,
      pageSize: 20,
      withDetails: true,
    });

    expect(lambdaClient.topic.getTopics.query).toHaveBeenCalledWith(
      expect.objectContaining({ current, excludeTriggers: ['channel'], pageSize: 20 }),
    );
  });

  it('preserves existing trigger exclusions without duplicating channel', async () => {
    await new TopicService().getTopics({
      agentId: 'agent',
      excludeTriggers: ['cron', 'channel'],
    });

    expect(lambdaClient.topic.getTopics.query).toHaveBeenCalledWith(
      expect.objectContaining({ excludeTriggers: ['channel', 'cron'] }),
    );
  });
});
