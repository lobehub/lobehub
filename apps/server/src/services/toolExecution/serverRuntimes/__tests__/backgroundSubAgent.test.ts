import { describe, expect, it, vi } from 'vitest';

import { MAX_RUNNING_BACKGROUND_SUB_AGENTS, startBackgroundSubAgent } from '../backgroundSubAgent';

// The running set the limit check counts: every started run's placeholder.
const placeholders = vi.hoisted(() => new Map<string, string[]>());

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {
      listBackgroundSubAgentCalls: async ({ topicId }: { topicId: string }) => {
        // Let concurrent checks interleave, as real database reads do.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return (placeholders.get(topicId) ?? []).map((id) => ({ id }));
      },
    };
  }),
}));

const startOn = (topicId: string, id: string) =>
  startBackgroundSubAgent({
    db: {} as any,
    retryHint: 'Retry in the foreground.',
    start: async () => {
      // The runner writes the placeholder before it resolves.
      await new Promise((resolve) => setTimeout(resolve, 5));
      placeholders.set(topicId, [...(placeholders.get(topicId) ?? []), id]);
      return id;
    },
    topicId,
    userId: 'user-1',
  });

describe('startBackgroundSubAgent', () => {
  // One tool batch runs its calls concurrently: without serializing, every call
  // counts the same empty running set and all of them start.
  it('starts no more than the limit when one batch fires calls concurrently', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: MAX_RUNNING_BACKGROUND_SUB_AGENTS + 2 }, (_, index) =>
        startOn('topic-batch', `call-${index}`),
      ),
    );

    expect(outcomes.filter((outcome) => 'result' in outcome)).toHaveLength(
      MAX_RUNNING_BACKGROUND_SUB_AGENTS,
    );
    expect(outcomes.filter((outcome) => 'refusal' in outcome)).toEqual([
      { refusal: expect.objectContaining({ code: 'BACKGROUND_SUB_AGENT_LIMIT' }) },
      { refusal: expect.objectContaining({ code: 'BACKGROUND_SUB_AGENT_LIMIT' }) },
    ]);
    expect(placeholders.get('topic-batch')).toHaveLength(MAX_RUNNING_BACKGROUND_SUB_AGENTS);
  });

  it('keeps the queue moving after a start throws', async () => {
    const failing = startBackgroundSubAgent({
      db: {} as any,
      retryHint: 'Retry in the foreground.',
      start: async () => {
        throw new Error('boom');
      },
      topicId: 'topic-throw',
      userId: 'user-1',
    });

    await expect(failing).rejects.toThrow('boom');
    await expect(startOn('topic-throw', 'after')).resolves.toEqual({ result: 'after' });
  });
});
