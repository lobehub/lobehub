// @vitest-environment node
import { ThreadType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';

import { HeterogeneousAgentService } from '..';

const { threads } = vi.hoisted(() => ({
  threads: new Map<string, { id: string; metadata?: Record<string, unknown>; type: string }>(),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn(function () {
    return {
      findById: vi.fn(async (id: string) => threads.get(id)),
      update: vi.fn(async (id: string, value: { metadata?: Record<string, unknown> }) => {
        const thread = threads.get(id);
        if (thread && value.metadata) threads.set(id, { ...thread, metadata: value.metadata });
      }),
    };
  }),
}));

const createService = (operation: { parentOperationId?: string; threadId?: string | null }) => {
  const topicModel = {
    findById: vi.fn(async () => ({ id: 'topic-1', metadata: { heteroSessionId: 'topic-sess' } })),
    settleRunningOperation: vi.fn(async () => ({ status: 'not_owner' as const })),
    updateMetadata: vi.fn(async () => undefined),
  };
  const service = new HeterogeneousAgentService({} as any, 'user-1', {
    agentOperationModel: {
      findById: vi.fn(async () => ({ id: 'op-1', metadata: {}, ...operation })),
      settleRunning: vi.fn(async () => undefined),
    } as any,
    persistenceHandler: { finish: vi.fn(async () => undefined) } as any,
    snapshotStore: null,
    streamEventManager: {
      publishStreamEvent: vi.fn(async () => 'ok'),
    } as unknown as IStreamEventManager,
    topicModel: topicModel as any,
  });
  return { service, topicModel };
};

const finish = (service: HeterogeneousAgentService, sessionId = 'cc-thread-sess') =>
  service.heteroFinish({
    agentType: 'claude-code',
    operationId: 'op-1',
    result: 'success',
    sessionId,
    topicId: 'topic-1',
  });

// An external agent running as a sub-agent keeps its session on its isolation
// thread, so a follow-up resumes it and the topic's own binding is untouched.
describe('HeterogeneousAgentService — sub-agent session per isolation thread', () => {
  beforeEach(() => {
    threads.clear();
    vi.spyOn(CompletionLifecycle.prototype, 'completeOperation').mockImplementation(async () => {
      // The thread hooks rewrite the metadata from what the run claimed it with.
      const thread = threads.get('thread-1');
      if (thread) threads.set('thread-1', { ...thread, metadata: { operationId: 'op-1' } });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds the session to the isolation thread, not the topic', async () => {
    threads.set('thread-1', { id: 'thread-1', metadata: {}, type: ThreadType.Isolation });
    const { service, topicModel } = createService({
      parentOperationId: 'op-parent',
      threadId: 'thread-1',
    });

    await finish(service);

    expect(topicModel.updateMetadata).not.toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ heteroSessionId: expect.anything() }),
    );
    // Re-bound after the completion hooks rewrote the metadata.
    expect(threads.get('thread-1')?.metadata).toMatchObject({ heteroSessionId: 'cc-thread-sess' });
  });

  it('keeps binding a run in an ordinary thread to the topic', async () => {
    threads.set('thread-1', { id: 'thread-1', metadata: {}, type: ThreadType.Continuation });
    const { service, topicModel } = createService({ threadId: 'thread-1' });

    await finish(service);

    expect(topicModel.updateMetadata).toHaveBeenCalledWith('topic-1', {
      heteroSessionId: 'cc-thread-sess',
    });
    expect(threads.get('thread-1')?.metadata).not.toHaveProperty('heteroSessionId');
  });

  it('resumes a sub-agent from its thread session', async () => {
    threads.set('thread-1', {
      id: 'thread-1',
      metadata: { heteroSessionId: 'cc-thread-sess' },
      type: ThreadType.Isolation,
    });
    const { service } = createService({});

    await expect(service.getThreadResumeSessionId('thread-1', 'topic-1')).resolves.toBe(
      'cc-thread-sess',
    );
  });

  // A new sub-agent starts fresh: the topic's session is the conversation's.
  it('does not hand a new sub-agent the topic session', async () => {
    threads.set('thread-new', { id: 'thread-new', metadata: {}, type: ThreadType.Isolation });
    const { service } = createService({});

    await expect(
      service.getThreadResumeSessionId('thread-new', 'topic-1'),
    ).resolves.toBeUndefined();
  });

  // Reads follow the same rule the writes bind by.
  it('resumes a run in an ordinary thread from the topic session', async () => {
    threads.set('thread-1', { id: 'thread-1', metadata: {}, type: ThreadType.Continuation });
    const { service } = createService({});

    await expect(service.getThreadResumeSessionId('thread-1', 'topic-1')).resolves.toBe(
      'topic-sess',
    );
  });
});
