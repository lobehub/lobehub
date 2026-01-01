import { describe, expect, it } from 'vitest';
import { MemorySourceType } from '@lobechat/types';

import { LobeChatTopicContextProvider } from './chatTopic';

const job = {
  source: MemorySourceType.ChatTopic,
  sourceId: 'topic-1',
  userId: 'user-1',
};

describe('LobeChatTopicContextProvider', () => {
  it('should build XML topic context with messages and metadata', async () => {
    const provider = new LobeChatTopicContextProvider({
      conversations: [
        {
          content: 'Hello',
          createdAt: new Date('2024-03-01T10:00:00.000Z'),
          role: 'user',
        },
        {
          content: 'Hi there',
          createdAt: new Date('2024-03-01T10:01:00.000Z'),
          role: 'assistant',
        },
      ],
      topic: {
        createdAt: new Date('2024-03-01T09:00:00.000Z'),
        id: 'topic-1',
        metadata: { userMemoryExtractStatus: 'pending' },
        title: 'Daily chat',
        updatedAt: new Date('2024-03-01T10:02:00.000Z'),
      },
      topicId: 'topic-1',
    });

    const result = await provider.buildContext(job);

    expect(result.context).toContain(
      '<chat_topic created_at="2024-03-01T09:00:00.000Z" id="topic-1" message_count="2" last_message_at="2024-03-01T10:01:00.000Z" updated_at="2024-03-01T10:02:00.000Z">',
    );
    expect(result.context).toContain('<topic_title>Daily chat</topic_title>');
    expect(result.context).toContain(
      '<topic_metadata>{"userMemoryExtractStatus":"pending"}</topic_metadata>',
    );
    expect(result.context).toContain(
      '<messages count="2"><message index="0" role="user" created_at="2024-03-01T10:00:00.000Z">Hello</message><message index="1" role="assistant" created_at="2024-03-01T10:01:00.000Z">Hi there</message></messages>',
    );
    expect(result.sourceId).toBe('topic-1');
    expect(result.userId).toBe('user-1');
  });
});
