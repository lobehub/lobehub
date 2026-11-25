import { expect, it, vi } from 'vitest';

import { getSendConversationMode } from './sendConversationMode';

vi.mock('@/services/chat/mecha', () => ({
  resolveAgentConfig: () => ({ chatConfig: { toolMode: 'agent' } }),
}));
it('uses committed message metadata when a paginated topic lookup fails', () => {
  expect(
    getSendConversationMode('agent', undefined, [
      { role: 'user', metadata: { conversationMode: 'chat' } },
    ]),
  ).toBe('chat');
});
