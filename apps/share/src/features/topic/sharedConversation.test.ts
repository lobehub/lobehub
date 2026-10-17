import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { MessageService } from '@/services/message';

import { primeSharedTopicMessages, toSharedConversationContext } from './sharedConversation';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    message: {
      getMessages: { query: vi.fn() },
      getMessagesByCursor: { query: vi.fn() },
    },
  },
}));

const query = vi.mocked(lambdaClient.message.getMessagesByCursor.query);

const topic = (overrides: Record<string, unknown> = {}) =>
  ({
    agentId: 'agent-1',
    groupId: null,
    shareId: 'share-1',
    topicId: 'topic-1',
    ...overrides,
  }) as any;

describe('primeSharedTopicMessages', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ hasMore: false, messages: [], nextCursor: null } as any);
  });

  // The list reads with the context it mounts with; a primed page keyed any
  // other way is a request the page pays for twice.
  it('primes the read the mounted list makes', async () => {
    const shared = topic();

    primeSharedTopicMessages(shared);
    await new MessageService().getMessageListPage(toSharedConversationContext(shared));

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', topicId: 'topic-1', topicShareId: 'share-1' }),
    );
  });

  it('carries a group share’s group into the read', () => {
    primeSharedTopicMessages(topic({ groupId: 'group-1', shareId: 'share-group' }));

    expect(query).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group-1' }));
  });

  it('skips a share the list would not read', () => {
    primeSharedTopicMessages(topic({ agentId: null, shareId: 'share-no-agent' }));

    expect(query).not.toHaveBeenCalled();
  });
});
