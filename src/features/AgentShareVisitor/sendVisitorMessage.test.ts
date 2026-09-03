import { LOADING_FLAT } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  associateMessageWithOperation: vi.fn(),
  executeGatewayAgent: vi.fn(),
  failOperation: vi.fn(),
  internal_dispatchMessage: vi.fn(),
  operations: {} as Record<string, { status: string }>,
  optimisticCreateTmpMessage: vi.fn(),
  startOperation: vi.fn(() => ({ abortController: new AbortController(), operationId: 'op-1' })),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => store },
}));

const { sendVisitorMessage } = await import('./sendVisitorMessage');

const params = { agentId: 'agent-1', message: 'hello', shareId: 'share-1', topicId: 'topic-1' };

describe('sendVisitorMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.operations = {};
    store.executeGatewayAgent.mockResolvedValue({
      assistantMessageId: 'a',
      operationId: 'srv-op',
      topicId: 'topic-1',
      userMessageId: 'u',
    });
  });

  // Regression: the composer used to call `executeGatewayAgent` bare, so the
  // list stayed empty until the first gateway event and nothing carried the
  // generating state.
  it('echoes the user bubble and an assistant placeholder before the gateway call, under a sendMessage op', async () => {
    await sendVisitorMessage(params);

    expect(store.startOperation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sendMessage' }),
    );
    const [userCall, assistantCall] = store.optimisticCreateTmpMessage.mock.calls;
    expect(userCall[0]).toMatchObject({ content: 'hello', role: 'user', topicId: 'topic-1' });
    expect(assistantCall[0]).toMatchObject({ content: LOADING_FLAT, role: 'assistant' });
    const userMessageId = userCall[1].tempMessageId;
    const assistantMessageId = assistantCall[1].tempMessageId;
    expect(store.associateMessageWithOperation).toHaveBeenCalledWith(userMessageId, 'op-1');
    expect(store.associateMessageWithOperation).toHaveBeenCalledWith(assistantMessageId, 'op-1');

    // Same ids handed to the server so the optimistic rows never re-key.
    expect(store.executeGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        clientIds: { assistantMessageId, userMessageId },
        context: { agentId: 'agent-1', agentShareId: 'share-1', scope: 'main', topicId: 'topic-1' },
        parentOperationId: 'op-1',
        tempMessageIds: [assistantMessageId],
      }),
    );
    // Existing topic: the server rows land in the same bucket, nothing to drop.
    expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
  });

  it('drops the pre-topic optimistic rows after a new topic was created', async () => {
    await sendVisitorMessage({ ...params, topicId: undefined });

    expect(store.executeGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ topicId: undefined }) }),
    );
    expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'deleteMessages' }),
      { operationId: 'op-1' },
    );
  });

  it('fails the op, removes the optimistic rows and rethrows when the gateway rejects', async () => {
    const error = new Error('limit');
    store.executeGatewayAgent.mockRejectedValueOnce(error);

    await expect(sendVisitorMessage(params)).rejects.toBe(error);

    expect(store.failOperation).toHaveBeenCalledWith('op-1', {
      message: 'limit',
      type: 'GatewayError',
    });
    expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'deleteMessages' }),
      { operationId: 'op-1' },
    );
  });

  it('keeps a cancelled op cancelled instead of marking it failed', async () => {
    store.operations = { 'op-1': { status: 'cancelled' } };
    store.executeGatewayAgent.mockRejectedValueOnce(new Error('aborted'));

    await expect(sendVisitorMessage(params)).rejects.toThrow('aborted');

    expect(store.failOperation).not.toHaveBeenCalled();
    expect(store.internal_dispatchMessage).toHaveBeenCalled();
  });
});
