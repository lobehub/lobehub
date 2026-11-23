import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendToBoardConversation } from './boardConversation';

const mocks = vi.hoisted(() => ({ getConversation: vi.fn(), sendMessage: vi.fn() }));

vi.mock('@/services/artboard', () => ({
  artboardService: { getConversation: mocks.getConversation },
}));
vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => ({ sendMessage: mocks.sendMessage }) },
}));

describe('sendToBoardConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConversation.mockResolvedValue({ agentId: 'agt_1' });
  });

  it('reports sent once the conversation accepts the message', async () => {
    mocks.sendMessage.mockImplementation(async ({ onMessageAccepted }) => onMessageAccepted());

    expect(await sendToBoardConversation('tpc_1', 'hi')).toBe('sent');
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ context: { agentId: 'agt_1', topicId: 'tpc_1' }, message: 'hi' }),
    );
  });

  it('reports a failure when the send settles without the message being accepted', async () => {
    mocks.sendMessage.mockResolvedValue(undefined);

    expect(await sendToBoardConversation('tpc_1', 'hi')).toBe('messageFailed');
  });

  it('reports a board with no conversation', async () => {
    mocks.getConversation.mockResolvedValue(null);

    expect(await sendToBoardConversation('tpc_1', 'hi')).toBe('noConversation');
    expect(await sendToBoardConversation(null, 'hi')).toBe('noConversation');
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
