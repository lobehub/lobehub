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
    claim: vi.fn(
      async (
        claimIdentity: typeof identity,
        launch: UnderstandingLaunchReference,
      ): Promise<UnderstandingLaunchReference> => {
        if (
          thread.topicId !== claimIdentity.topicId ||
          thread.agentId !== claimIdentity.agentId ||
          thread.type !== ThreadType.Isolation ||
          thread.metadata.onboardingUnderstanding?.kind !== claimIdentity.kind
        ) {
          throw new Error('Understanding launch thread is unavailable');
        }
        const marker = thread.metadata.onboardingUnderstanding;
        if (marker.launch) return marker.launch;
        thread.metadata = {
          ...thread.metadata,
          onboardingUnderstanding: { ...marker, launch },
        };
        return launch;
      },
    ),
    findById: vi.fn(async () => thread),
  };
  const topics = { findById: vi.fn(async () => topic) };
  return {
    store: new UnderstandingLaunchStore({ threads, topics }),
    thread,
    threads,
    topic,
    topics,
  };
};

describe('UnderstandingLaunchStore', () => {
  it('atomically returns one winner when concurrent launches claim the same thread', async () => {
    const harness = createHarness();
    const first = { assistantMessageId: 'message-1', operationId: 'operation-1' };
    const second = { assistantMessageId: 'message-2', operationId: 'operation-2' };

    const claimed = await Promise.all([
      harness.store.save(identity, first),
      harness.store.save(identity, second),
    ]);

    expect(claimed[0]).toEqual(claimed[1]);
    expect(claimed).toContainEqual(first);
    expect(claimed).not.toContainEqual(second);
  });

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
    expect(harness.threads.claim).toHaveBeenCalledWith(identity, {
      assistantMessageId: 'message-fallback',
      operationId: 'operation-fallback',
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
    expect(harness.threads.claim).not.toHaveBeenCalled();
  });
});
