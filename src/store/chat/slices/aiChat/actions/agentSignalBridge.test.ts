import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/agentSignal', () => ({
  agentSignalService: {
    emitClientGatewaySourceEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/store/user/store', () => ({
  getUserStoreState: vi.fn(),
}));

describe('emitClientAgentSignalSourceEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal('window', {
      global_serverConfigStore: {
        getState: () => ({
          featureFlags: { enableAgentSelfIteration: true },
          serverConfigInit: true,
        }),
      },
    });
  });

  it('emits the full client.runtime.start payload shape', async () => {
    const { agentSignalService } = await import('@/services/agentSignal');
    const { getUserStoreState } = await import('@/store/user/store');
    const { emitClientAgentSignalSourceEvent } = await import('./agentSignalBridge');

    vi.mocked(getUserStoreState).mockReturnValue({
      isUserStateInit: true,
      preference: { lab: { enableAgentSelfIteration: true } },
    } as never);

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
    const { getUserStoreState } = await import('@/store/user/store');
    const { emitClientAgentSignalSourceEvent } = await import('./agentSignalBridge');

    vi.mocked(getUserStoreState).mockReturnValue({
      isUserStateInit: true,
      preference: { lab: { enableAgentSelfIteration: true } },
    } as never);

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

  it('skips emitting when the rollout feature flag is disabled after server config init', async () => {
    const { agentSignalService } = await import('@/services/agentSignal');
    const { getUserStoreState } = await import('@/store/user/store');
    const { emitClientAgentSignalSourceEvent } = await import('./agentSignalBridge');

    vi.stubGlobal('window', {
      global_serverConfigStore: {
        getState: () => ({
          featureFlags: { enableAgentSelfIteration: false },
          serverConfigInit: true,
        }),
      },
    });
    vi.mocked(getUserStoreState).mockReturnValue({
      isUserStateInit: true,
      preference: { lab: { enableAgentSelfIteration: true } },
    } as never);

    await emitClientAgentSignalSourceEvent({
      payload: {
        agentId: 'agent-1',
        operationId: 'op-1',
        parentMessageId: 'msg-1',
        parentMessageType: 'user',
      },
      sourceId: 'op-1:client:start',
      sourceType: 'client.runtime.start',
      timestamp: 1,
    });

    expect(agentSignalService.emitClientGatewaySourceEvent).not.toHaveBeenCalled();
  });

  it('skips emitting when user preference is initialized but the lab toggle is disabled', async () => {
    const { agentSignalService } = await import('@/services/agentSignal');
    const { getUserStoreState } = await import('@/store/user/store');
    const { emitClientAgentSignalSourceEvent } = await import('./agentSignalBridge');

    vi.mocked(getUserStoreState).mockReturnValue({
      isUserStateInit: true,
      preference: { lab: { enableAgentSelfIteration: false } },
    } as never);

    await emitClientAgentSignalSourceEvent({
      payload: {
        agentId: 'agent-1',
        operationId: 'op-1',
        parentMessageId: 'msg-1',
        parentMessageType: 'user',
      },
      sourceId: 'op-1:client:start',
      sourceType: 'client.runtime.start',
      timestamp: 1,
    });

    expect(agentSignalService.emitClientGatewaySourceEvent).not.toHaveBeenCalled();
  });

  it('keeps emitting before local stores finish initialization so the server can decide', async () => {
    const { agentSignalService } = await import('@/services/agentSignal');
    const { getUserStoreState } = await import('@/store/user/store');
    const { emitClientAgentSignalSourceEvent } = await import('./agentSignalBridge');

    vi.stubGlobal('window', {
      global_serverConfigStore: {
        getState: () => ({
          featureFlags: { enableAgentSelfIteration: false },
          serverConfigInit: false,
        }),
      },
    });
    vi.mocked(getUserStoreState).mockReturnValue({
      isUserStateInit: false,
      preference: { lab: { enableAgentSelfIteration: false } },
    } as never);

    await emitClientAgentSignalSourceEvent({
      payload: {
        agentId: 'agent-1',
        operationId: 'op-1',
        parentMessageId: 'msg-1',
        parentMessageType: 'user',
      },
      sourceId: 'op-1:client:start',
      sourceType: 'client.runtime.start',
      timestamp: 1,
    });

    expect(agentSignalService.emitClientGatewaySourceEvent).toHaveBeenCalledOnce();
  });
});
