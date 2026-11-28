import { expect, it, vi } from 'vitest';

import { userTurnConversationMode } from './userTurnConversationMode';

it('stamps a sub-agent thread user turn with the host topic mode', async () => {
  const topicModel = {
    findById: vi.fn().mockResolvedValue({ metadata: { conversationMode: 'chat' } }),
    resolveConversationMode: vi.fn(),
  };
  expect(
    await userTurnConversationMode({
      db: {} as never,
      topicId: 'parent',
      threadId: 'sub-thread',
      userId: 'owner',
      chatConfig: { toolMode: 'custom' },
      topicModel,
    }),
  ).toBe('chat');
});
