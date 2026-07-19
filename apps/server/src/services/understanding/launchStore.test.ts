import type { ThreadMetadata } from '@lobechat/types';
import { ThreadType } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { type UnderstandingLaunchReference, UnderstandingLaunchStore } from './launchStore';

const identity = {
  agentId: 'understanding-agent',
  kind: 'source' as const,
  threadId: 'source-thread',
  topicId: 'onboarding-topic',
};

const createHarness = () => {
  const thread: {
    agentId: string;
    metadata: ThreadMetadata;
    topicId: string;
    type: string;
  } = {
    agentId: identity.agentId,
    metadata: { keep: true, onboardingUnderstanding: { kind: identity.kind } },
    topicId: identity.topicId,
    type: ThreadType.Isolation,
  };
  const durable = {
    find: vi.fn(async (): Promise<UnderstandingLaunchReference | undefined> => undefined),
  };
  const topic: {
    metadata: {
      runningOperation?: {
        assistantMessageId: string;
        operationId: string;
        threadId?: string;
      } | null;
    };
  } = { metadata: {} };
  const threads = {
    findById: vi.fn(async () => thread),
    update: vi.fn(async (_threadId: string, value: { metadata: ThreadMetadata }) => {
      thread.metadata = value.metadata;
    }),
  };
  const topics = { findById: vi.fn(async () => topic) };
  return {
    durable,
    store: new UnderstandingLaunchStore({ durable, threads, topics }),
    thread,
    threads,
    topic,
    topics,
  };
};

describe('UnderstandingLaunchStore', () => {
  it('recovers an explicitly paired launch from the dedicated thread marker', async () => {
    const harness = createHarness();
    harness.thread.metadata.onboardingUnderstanding = {
      kind: 'source',
      launch: { assistantMessageId: 'message-1', operationId: 'operation-1' },
    };

    await expect(harness.store.find(identity)).resolves.toEqual({
      assistantMessageId: 'message-1',
      operationId: 'operation-1',
    });
    expect(harness.topics.findById).not.toHaveBeenCalled();
    expect(harness.durable.find).not.toHaveBeenCalled();
  });

  it('promotes a durable launch pair before consulting topic metadata', async () => {
    const harness = createHarness();
    harness.durable.find.mockResolvedValue({
      assistantMessageId: 'durable-message',
      operationId: 'durable-operation',
    });

    await expect(harness.store.find(identity)).resolves.toEqual({
      assistantMessageId: 'durable-message',
      operationId: 'durable-operation',
    });
    expect(harness.topics.findById).not.toHaveBeenCalled();
    expect(harness.threads.update).toHaveBeenCalledWith(identity.threadId, {
      metadata: {
        keep: true,
        onboardingUnderstanding: {
          kind: 'source',
          launch: {
            assistantMessageId: 'durable-message',
            operationId: 'durable-operation',
          },
        },
      },
    });
  });

  it('promotes an exact topic runningOperation fallback into the thread marker', async () => {
    const harness = createHarness();
    harness.topic.metadata.runningOperation = {
      assistantMessageId: 'message-fallback',
      operationId: 'operation-fallback',
      threadId: identity.threadId,
    };

    const recovered = await harness.store.find(identity);
    harness.topic.metadata.runningOperation = null;

    expect(recovered).toEqual({
      assistantMessageId: 'message-fallback',
      operationId: 'operation-fallback',
    });
    expect(harness.threads.update).toHaveBeenCalledWith(identity.threadId, {
      metadata: {
        keep: true,
        onboardingUnderstanding: {
          kind: 'source',
          launch: {
            assistantMessageId: 'message-fallback',
            operationId: 'operation-fallback',
          },
        },
      },
    });
    await expect(harness.store.find(identity)).resolves.toEqual(recovered);
  });

  it.each([
    ['topic', { topicId: 'different-topic' }],
    ['agent', { agentId: 'different-agent' }],
    ['type', { type: ThreadType.Standalone }],
    ['marker', { metadata: { onboardingUnderstanding: { kind: 'merged' } } }],
  ])('rejects a mismatched %s on the dedicated thread', async (_label, patch) => {
    const harness = createHarness();
    Object.assign(harness.thread, patch);

    await expect(harness.store.find(identity)).rejects.toThrow(
      'Understanding launch thread is unavailable',
    );
  });

  it('does not use a topic fallback belonging to another thread', async () => {
    const harness = createHarness();
    harness.topic.metadata.runningOperation = {
      assistantMessageId: 'other-message',
      operationId: 'other-operation',
      threadId: 'other-thread',
    };

    await expect(harness.store.find(identity)).resolves.toBeUndefined();
    expect(harness.threads.update).not.toHaveBeenCalled();
  });
});
