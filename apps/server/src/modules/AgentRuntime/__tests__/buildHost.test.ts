import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildHost } from '../buildHost';
import type { RuntimeExecutorContext } from '../context';

const { MockServerCompressionTransport, MockServerOperationStore } = vi.hoisted(() => ({
  MockServerCompressionTransport: vi.fn(() => ({ kind: 'compression' })),
  MockServerOperationStore: vi.fn(() => ({ kind: 'operation-store' })),
}));

vi.mock('../adapters/ServerCompressionTransport', () => ({
  ServerCompressionTransport: MockServerCompressionTransport,
}));

vi.mock('../adapters/ServerOperationStore', () => ({
  ServerOperationStore: MockServerOperationStore,
}));

describe('buildHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the actor for conversation adapters under a delegated principal', () => {
    const loadAgentState = vi.fn();
    const serverDB = {} as RuntimeExecutorContext['serverDB'];
    const ctx: RuntimeExecutorContext = {
      loadAgentState,
      messageModel: {} as RuntimeExecutorContext['messageModel'],
      operationId: 'operation-1',
      principal: {
        actorUserId: 'visitor-user',
        resourceOwnerUserId: 'creator-user',
      },
      serverDB,
      stepIndex: 0,
      streamManager: {} as RuntimeExecutorContext['streamManager'],
      toolExecutionService: {} as RuntimeExecutorContext['toolExecutionService'],
      topicId: 'topic-1',
      workspaceId: 'workspace-1',
    };

    const host = buildHost(ctx);

    expect(MockServerCompressionTransport).toHaveBeenCalledWith(
      serverDB,
      'visitor-user',
      'workspace-1',
    );
    expect(MockServerOperationStore).toHaveBeenCalledWith(
      serverDB,
      'visitor-user',
      'workspace-1',
      'topic-1',
      'operation-1',
      loadAgentState,
    );
    expect(host.operation.userId).toBe('creator-user');
  });
});
