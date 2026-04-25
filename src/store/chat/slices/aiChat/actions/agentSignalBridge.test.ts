import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/agentSignal', () => ({
  agentSignalService: {
    emitClientGatewaySourceEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('emitClientAgentSignalSourceEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits the full client.runtime.start payload shape', async () => {
    const { agentSignalService } = await import('@/services/agentSignal');
    const { emitClientAgentSignalSourceEvent } = await import('./agentSignalBridge');

    await emitClientAgentSignalSourceEvent({
      payload: {
        agentId: 'agent-1',
        operationId: 'op-1',
        parentMessageId: 'msg-1',
        parentMessageType: 'user',
        threadId: 'thread-1',
        topicId: 'topic-1',
      },
      sourceId: 'op-1:client:start',
      sourceType: 'client.runtime.start',
      timestamp: 1,
    });

    expect(agentSignalService.emitClientGatewaySourceEvent).toHaveBeenCalledWith({
      payload: {
        agentId: 'agent-1',
        operationId: 'op-1',
        parentMessageId: 'msg-1',
        parentMessageType: 'user',
        threadId: 'thread-1',
        topicId: 'topic-1',
      },
      sourceId: 'op-1:client:start',
      sourceType: 'client.runtime.start',
      timestamp: 1,
    });
  });

  it('emits the full client.runtime.complete payload shape', async () => {
    const { agentSignalService } = await import('@/services/agentSignal');
    const { emitClientAgentSignalSourceEvent } = await import('./agentSignalBridge');

    await emitClientAgentSignalSourceEvent({
      payload: {
        agentId: 'agent-1',
        operationId: 'op-1',
        status: 'done',
        threadId: 'thread-1',
        topicId: 'topic-1',
      },
      sourceId: 'op-1:client:complete',
      sourceType: 'client.runtime.complete',
      timestamp: 2,
    });

    expect(agentSignalService.emitClientGatewaySourceEvent).toHaveBeenCalledWith({
      payload: {
        agentId: 'agent-1',
        operationId: 'op-1',
        status: 'done',
        threadId: 'thread-1',
        topicId: 'topic-1',
      },
      sourceId: 'op-1:client:complete',
      sourceType: 'client.runtime.complete',
      timestamp: 2,
    });
  });
});
