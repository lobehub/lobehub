import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';
import { shareChatService } from '@/services/shareChat';
import type { QueuedMessage } from '@/store/chat/slices/operation/types';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

const context = { agentId: 'agent-1', scope: 'main' as const, threadId: null, topicId: 'topic-1' };
const contextKey = messageMapKey(context);

const queued = (id: string): QueuedMessage => ({
  content: `follow up ${id}`,
  createdAt: 1,
  id,
  interruptMode: 'soft',
});

const operation = (id: string, overrides: Record<string, unknown> = {}) => ({
  abortController: new AbortController(),
  childOperationIds: [],
  context,
  id,
  metadata: { serverOperationId: `server-${id}`, startTime: 1 },
  status: 'running',
  type: 'execServerAgentRuntime',
  ...overrides,
});

const seedOperations = (operations: ReturnType<typeof operation>[]) => {
  useChatStore.setState({
    operations: Object.fromEntries(operations.map((op) => [op.id, op])) as any,
    operationsByContext: { [contextKey]: operations.map((op) => op.id) },
  });
};

describe('queued messages flag', () => {
  let setQueuedMessages: ReturnType<typeof vi.spyOn>;
  let setShareQueuedMessages: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
    setQueuedMessages = vi
      .spyOn(aiAgentService, 'setQueuedMessages')
      .mockResolvedValue({ success: true });
    setShareQueuedMessages = vi
      .spyOn(shareChatService, 'setQueuedMessages')
      .mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flags the running Gateway run when a message is queued behind it', () => {
    seedOperations([operation('gw')]);

    useChatStore.getState().enqueueMessage(contextKey, queued('q1'), 'gw');

    expect(setQueuedMessages).toHaveBeenCalledWith({ operationId: 'server-gw', pending: true });
  });

  it('clears the flag only once the last queued message is removed', () => {
    seedOperations([operation('gw')]);
    const store = useChatStore.getState();
    store.enqueueMessage(contextKey, queued('q1'), 'gw');
    store.enqueueMessage(contextKey, queued('q2'), 'gw');
    setQueuedMessages.mockClear();

    store.removeQueuedMessage(contextKey, 'q1');
    expect(setQueuedMessages).not.toHaveBeenCalled();

    store.removeQueuedMessage(contextKey, 'q2');
    expect(setQueuedMessages).toHaveBeenCalledWith({ operationId: 'server-gw', pending: false });
  });

  it('does not flag a run executing in the browser', () => {
    seedOperations([operation('client', { metadata: { startTime: 1 }, type: 'execAgentRuntime' })]);

    useChatStore.getState().enqueueMessage(contextKey, queued('q1'), 'client');

    expect(setQueuedMessages).not.toHaveBeenCalled();
  });

  it('routes a share visitor run through the share endpoint', () => {
    seedOperations([operation('gw', { context: { ...context, agentShareId: 'share-1' } })]);

    useChatStore.getState().enqueueMessage(contextKey, queued('q1'), 'gw');

    expect(setShareQueuedMessages).toHaveBeenCalledWith('share-1', 'topic-1', 'server-gw', true);
    expect(setQueuedMessages).not.toHaveBeenCalled();
  });

  it('leaves group member runs to their supervisor', () => {
    seedOperations([
      operation('supervisor'),
      operation('member', { parentOperationId: 'supervisor' }),
    ]);

    useChatStore.getState().enqueueMessage(contextKey, queued('q1'), 'supervisor');

    expect(setQueuedMessages).toHaveBeenCalledTimes(1);
    expect(setQueuedMessages).toHaveBeenCalledWith({
      operationId: 'server-supervisor',
      pending: true,
    });
  });
});
