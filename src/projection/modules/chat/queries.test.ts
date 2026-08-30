import type { ChatTopic } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { topicService } from '@/services/topic';

import { executeProjectionQuery } from '../../query/runtime';
import { useProjectionStore } from '../../store';
import { chatTopicDetailProjectionQuery } from './queries';
import { selectChatTopicDetailItem } from './selectors';

const SCOPE = 'user-1:personal';

vi.mock('@/services/topic', () => ({
  topicService: { getTopicDetail: vi.fn() },
}));

describe('Chat Projection queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectionStore.setState({ scopes: {} });
  });

  it('projects a by-id topic detail that is absent from the paginated list', async () => {
    const archivedTopic = {
      createdAt: Date.parse('2026-08-01T00:00:00.000Z'),
      description: 'Archived topic detail',
      favorite: false,
      firstUserMessage: 'First message',
      id: 'archived-topic',
      messageCount: 4,
      sessionId: 'agent-1',
      status: 'completed',
      title: 'Archived topic',
      trigger: null,
      updatedAt: Date.parse('2026-08-02T00:00:00.000Z'),
    } as ChatTopic;
    vi.mocked(topicService.getTopicDetail).mockResolvedValue(archivedTopic);

    await executeProjectionQuery(
      chatTopicDetailProjectionQuery,
      { topicId: archivedTopic.id },
      SCOPE,
    );

    expect(topicService.getTopicDetail).toHaveBeenCalledWith(archivedTopic.id);
    expect(
      selectChatTopicDetailItem(useProjectionStore.getState().scopes[SCOPE], archivedTopic.id),
    ).toMatchObject({
      description: 'Archived topic detail',
      messageCount: 4,
      status: 'completed',
      title: 'Archived topic',
    });
  });
});
