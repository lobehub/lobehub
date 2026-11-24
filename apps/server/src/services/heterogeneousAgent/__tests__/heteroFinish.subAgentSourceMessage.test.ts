// @vitest-environment node
import { ThreadType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';

import { HeterogeneousAgentService } from '..';

const { messageUpdate, threads } = vi.hoisted(() => ({
  messageUpdate: vi.fn(async () => undefined),
  threads: new Map<string, Record<string, unknown>>(),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn(function () {
    return {
      findById: vi.fn(async (id: string) => threads.get(id)),
      update: vi.fn(async () => undefined),
    };
  }),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return {
      findById: vi.fn(async () => ({ content: 'the second answer', id: 'assistant-2' })),
      update: messageUpdate,
    };
  }),
}));

const finish = (hooks: unknown[]) => {
  const service = new HeterogeneousAgentService({} as any, 'user-1', {
    agentOperationModel: {
      findById: vi.fn(async () => ({
        id: 'op-2',
        metadata: { _hooks: hooks, assistantMessageId: 'assistant-2' },
        parentOperationId: 'op-parent',
        threadId: 'thread-1',
      })),
      settleRunning: vi.fn(async () => undefined),
    } as any,
    persistenceHandler: { finish: vi.fn(async () => undefined) } as any,
    snapshotStore: null,
    streamEventManager: {
      publishStreamEvent: vi.fn(async () => 'ok'),
    } as unknown as IStreamEventManager,
    topicModel: {
      findById: vi.fn(async () => ({ id: 'topic-1', metadata: {} })),
      settleRunningOperation: vi.fn(async () => ({ status: 'not_owner' as const })),
      updateMetadata: vi.fn(async () => undefined),
    } as any,
  });

  return service.heteroFinish({
    agentType: 'claude-code',
    operationId: 'op-2',
    result: 'success',
    sessionId: 'cc-sess',
    topicId: 'topic-1',
  });
};

describe('HeterogeneousAgentService — a sub-agent thread and its source message', () => {
  beforeEach(() => {
    threads.clear();
    messageUpdate.mockClear();
    // The thread keeps the message that first spawned it as its source.
    threads.set('thread-1', {
      id: 'thread-1',
      metadata: {},
      sourceMessageId: 'tool-first-call',
      type: ThreadType.Isolation,
    });
    vi.spyOn(CompletionLifecycle.prototype, 'completeOperation').mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The completion bridge writes each call's own tool result. A follow-up is a
  // new call on the same thread: its answer must not replace the first one's.
  it('leaves the first call result alone when a follow-up to the sub-agent finishes', async () => {
    await finish([
      {
        id: 'sub-agent-bridge',
        type: 'onComplete',
        webhook: {
          body: {
            parentOperationId: 'op-parent',
            threadId: 'thread-1',
            toolMessageId: 'tool-second-call',
          },
          url: '/api/agent/webhooks/subagent-callback',
        },
      },
    ]);

    expect(messageUpdate).not.toHaveBeenCalledWith('tool-first-call', expect.anything());
  });

  it('still projects the answer of a run nothing else reports', async () => {
    await finish([]);

    expect(messageUpdate).toHaveBeenCalledWith('tool-first-call', {
      content: 'the second answer',
    });
  });
});
